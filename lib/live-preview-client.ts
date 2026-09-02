"use client";

import { strFromU8, unzipSync } from "fflate";
import type { FileSystemTree, WebContainer, WebContainerProcess } from "@webcontainer/api";

const PREVIEW_BRIDGE = String.raw`(() => {
  const params = new URLSearchParams(location.search);
  const frameId = params.get("__ah_frame");
  const initialY = Number(params.get("__ah_scroll_y") || 0);
  const parentOrigin = document.referrer ? new URL(document.referrer).origin : "*";
  let timer = 0;
  const report = () => parent.postMessage({ type: "agent-harness:scroll", frameId, route: location.pathname, x: scrollX, y: scrollY, capturedAt: new Date().toISOString() }, parentOrigin);
  addEventListener("scroll", () => { clearTimeout(timer); timer = setTimeout(report, 100); }, { passive: true });
  addEventListener("load", () => { requestAnimationFrame(() => { scrollTo(0, initialY); report(); }); });
  addEventListener("message", (event) => {
    if (event.origin !== parentOrigin || event.data?.type !== "agent-harness:restore-scroll" || event.data.frameId !== frameId) return;
    scrollTo(Number(event.data.x || 0), Number(event.data.y || 0));
  });
})();`;

export type LivePreviewStatus = "idle" | "downloading" | "mounting" | "installing" | "starting" | "ready" | "error";
export type LivePreviewEvent = { status: LivePreviewStatus; message: string; url?: string };

let containerPromise: Promise<WebContainer> | null = null;
let activeProcess: WebContainerProcess | null = null;
let activeWorkspace = "";

function safeArchivePath(path: string) {
  const normalized = path.replace(/\\/g, "/").split("/").slice(1).join("/");
  if (!normalized || normalized.startsWith("/") || normalized.split("/").includes("..")) return null;
  if (/^(?:node_modules|\.git|dist|build|\.next|coverage)(?:\/|$)/.test(normalized)) return null;
  return normalized;
}

function insertFile(root: FileSystemTree, path: string, bytes: Uint8Array) {
  const parts = path.split("/");
  let current = root;
  for (const part of parts.slice(0, -1)) {
    const existing = current[part];
    if (!existing || !("directory" in existing)) current[part] = { directory: {} };
    current = (current[part] as { directory: FileSystemTree }).directory;
  }
  const binary = /\.(?:png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|pdf|zip)$/i.test(path);
  current[parts.at(-1)!] = { file: { contents: binary ? bytes : strFromU8(bytes) } };
}

export function repositoryArchiveToTree(archive: Uint8Array) {
  const entries = unzipSync(archive);
  const tree: FileSystemTree = {};
  let total = 0; let count = 0;
  for (const [archivePath, bytes] of Object.entries(entries)) {
    const path = safeArchivePath(archivePath);
    if (!path || archivePath.endsWith("/")) continue;
    if (bytes.byteLength > 5 * 1024 * 1024) throw new Error(`${path} exceeds the 5 MB per-file preview limit.`);
    total += bytes.byteLength; count += 1;
    if (total > 25 * 1024 * 1024 || count > 1_500) throw new Error("Repository exceeds the bounded live-preview import limits.");
    if (path === "index.html") {
      const html = strFromU8(bytes);
      const tag = '<script src="/__agent-harness-bridge.js"></script>';
      insertFile(tree, path, new TextEncoder().encode(html.includes("</head>") ? html.replace("</head>", `${tag}</head>`) : `${tag}${html}`));
    } else insertFile(tree, path, bytes);
  }
  if (!tree["package.json"]) throw new Error("This repository has no root package.json. Monorepo package selection is not available yet.");
  insertFile(tree, "public/__agent-harness-bridge.js", new TextEncoder().encode(PREVIEW_BRIDGE));
  return tree;
}

async function container() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("Live preview requires desktop Chromium with cross-origin isolation.");
  containerPromise ??= import("@webcontainer/api").then(({ WebContainer }) => WebContainer.boot({ coep: "credentialless" }));
  return containerPromise;
}

async function resetWorkspace(instance: WebContainer, workspaceId: string, files: FileSystemTree) {
  if (activeProcess) { activeProcess.kill(); activeProcess = null; }
  if (activeWorkspace) await instance.fs.rm(`/workspaces/${activeWorkspace}`, { recursive: true, force: true }).catch(() => undefined);
  await instance.mount({ workspaces: { directory: { [workspaceId]: { directory: files } } } });
  activeWorkspace = workspaceId;
}

function commands(files: FileSystemTree) {
  const manager = files["pnpm-lock.yaml"] ? "pnpm" : files["yarn.lock"] ? "yarn" : "npm";
  const install = manager === "pnpm" ? ["pnpm", ["install", "--frozen-lockfile"]] : manager === "yarn" ? ["yarn", ["install", "--immutable"]] : files["package-lock.json"] ? ["npm", ["ci"]] : ["npm", ["install"]];
  return { manager, install: install as [string, string[]], start: [manager, ["run", "dev"]] as [string, string[]] };
}

export async function startLiveRepositoryPreview(input: { workspaceId: string; repositoryUrl: string; ref: string; onEvent: (event: LivePreviewEvent) => void }) {
  input.onEvent({ status: "downloading", message: "Downloading the approved repository archive…" });
  const response = await fetch(`/api/github/archive?repositoryUrl=${encodeURIComponent(input.repositoryUrl)}&ref=${encodeURIComponent(input.ref)}`, { cache: "no-store" });
  if (!response.ok) { const payload = await response.json().catch(() => ({ error: "Archive download failed." })); throw new Error(payload.error); }
  const files = repositoryArchiveToTree(new Uint8Array(await response.arrayBuffer()));
  input.onEvent({ status: "mounting", message: "Mounting one bounded source tree…" });
  const instance = await container();
  await resetWorkspace(instance, input.workspaceId, files);
  const cwd = `/workspaces/${input.workspaceId}`;
  const { manager, install, start } = commands(files);
  if (manager !== "npm") { const corepack = await instance.spawn("corepack", ["enable"], { cwd }); if (await corepack.exit !== 0) throw new Error(`Unable to enable ${manager} in the preview runtime.`); }
  input.onEvent({ status: "installing", message: `Installing locked dependencies with ${manager}…` });
  const installProcess = await instance.spawn(install[0], install[1], { cwd });
  if (await installProcess.exit !== 0) throw new Error("Dependency installation failed. Review the repository scripts and lockfile before retrying.");
  input.onEvent({ status: "starting", message: "Starting the repository dev server…" });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The dev server did not become ready within two minutes.")), 120_000);
    const unsubscribe = instance.on("server-ready", (_port, readyUrl) => { window.clearTimeout(timer); unsubscribe(); resolve(readyUrl); });
    void instance.spawn(start[0], start[1], { cwd }).then((process) => {
      activeProcess = process;
      void process.exit.then((code) => { if (code !== 0) { window.clearTimeout(timer); reject(new Error(`The dev server stopped with exit code ${code}.`)); } });
    }, reject);
  });
  input.onEvent({ status: "ready", message: "Real repository preview ready.", url });
  return url;
}

export async function readLiveSource(path: string) {
  const instance = await container();
  if (!activeWorkspace) throw new Error("Start the live repository preview first.");
  return instance.fs.readFile(`/workspaces/${activeWorkspace}/${path}`, "utf-8");
}

export async function writeLiveSource(path: string, content: string) {
  const instance = await container();
  if (!activeWorkspace) throw new Error("Start the live repository preview first.");
  await instance.fs.writeFile(`/workspaces/${activeWorkspace}/${path}`, content);
}

export async function stopLiveRepositoryPreview() {
  if (activeProcess) { activeProcess.kill(); activeProcess = null; }
}
