"use client";

import { unzipSync } from "fflate";
import type { FileSystemTree, WebContainer, WebContainerProcess } from "@webcontainer/api";
import { MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, MAX_FILE_BYTES, MAX_ARCHIVE_FILES, safeRepositoryPath } from "./archive-policy";

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
  const normalized = path.split("/").slice(1).join("/").replace(/\/$/, "");
  if (!normalized) return null;
  safeRepositoryPath(normalized);
  if (/(?:^|\/)(?:node_modules|\.git|dist|build|\.next|coverage)(?:\/|$)/.test(normalized)) return null;
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
  // Keeping bytes avoids corrupting unrecognized binary formats (e.g. MP4/WASM)
  // and avoids another UTF-16 copy of the entire repository in memory.
  current[parts.at(-1)!] = { file: { contents: bytes } };
}

export function repositoryArchiveToTree(archive: Uint8Array) {
  if (archive.byteLength > MAX_ARCHIVE_BYTES) throw new Error("Repository archive exceeds the 128 MiB transfer limit.");
  let total = 0; let count = 0;
  // fflate invokes the filter using ZIP directory metadata, BEFORE inflation.
  // The old post-inflate check could allocate a ZIP bomb before rejecting it.
  const entries = unzipSync(archive, { filter: (entry) => {
    const path = safeArchivePath(entry.name);
    if (!path || entry.name.endsWith('/')) return false;
    if (entry.originalSize > MAX_FILE_BYTES) throw new Error(`${path} exceeds the 16 MiB per-file preview limit.`);
    total += entry.originalSize; count++;
    if (total > MAX_EXPANDED_BYTES || count > MAX_ARCHIVE_FILES) throw new Error("Repository exceeds the 128 MiB expanded / 10,000-file preview limit.");
    return true;
  } });
  const tree: FileSystemTree = {};
  for (const [archivePath, bytes] of Object.entries(entries)) {
    const path = safeArchivePath(archivePath);
    if (!path || archivePath.endsWith("/")) continue;
    insertFile(tree, path, bytes);
  }
  if (!tree["package.json"]) throw new Error("This repository has no root package.json. Monorepo package selection is not available yet.");
  return tree;
}

async function container() {
  if (!globalThis.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") throw new Error("Live preview requires desktop Chromium with cross-origin isolation.");
  containerPromise ??= import("@webcontainer/api").then(({ WebContainer }) => WebContainer.boot({ coep: "credentialless" })).catch(error => { containerPromise = null; throw error; });
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
  if (!response.ok) { const payload = await response.json().catch(() => ({ error: "Archive download failed." })) as { error?: string }; throw new Error(payload.error ?? "Archive download failed."); }
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await response.arrayBuffer()); }
  catch { throw new Error("Archive transfer was interrupted or exceeded its limit. Retry after checking repository size and connection."); }
  const files = repositoryArchiveToTree(bytes);
  input.onEvent({ status: "mounting", message: "Mounting one bounded source tree…" });
  const instance = await container();
  await resetWorkspace(instance, input.workspaceId, files);
  // Preview-only injection covers Next as well as Vite without modifying the
  // authoritative layout/index file or adding publishable instrumentation.
  await instance.setPreviewScript(PREVIEW_BRIDGE);
  const cwd = `/workspaces/${input.workspaceId}`;
  const { manager, install, start } = commands(files);
  if (manager !== "npm") { const corepack = await instance.spawn("corepack", ["enable"], { cwd }); if (await corepack.exit !== 0) throw new Error(`Unable to enable ${manager} in the preview runtime.`); }
  input.onEvent({ status: "installing", message: `Installing locked dependencies with ${manager}…` });
  const installProcess = await instance.spawn(install[0], install[1], { cwd });
  let installLog = "";
  const drain = installProcess.output.pipeTo(new WritableStream({ write(chunk) { installLog = (installLog + chunk).slice(-2000); } }));
  const installCode = await installProcess.exit; await drain;
  if (installCode !== 0) throw new Error(`Dependency installation failed. ${installLog.replace(/\x1b\[[0-9;]*m/g, '').slice(-900)}`);
  input.onEvent({ status: "starting", message: "Starting the repository dev server…" });
  const url = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("The dev server did not become ready within two minutes.")), 120_000);
    const unsubscribe = instance.on("server-ready", (_port, readyUrl) => { window.clearTimeout(timer); unsubscribe(); resolve(readyUrl); });
    void instance.spawn(start[0], start[1], { cwd }).then((process) => {
      activeProcess = process;
      void process.output.pipeTo(new WritableStream({ write() {} })).catch(() => undefined);
      void process.exit.then((code) => { if (code !== 0) { window.clearTimeout(timer); reject(new Error(`The dev server stopped with exit code ${code}.`)); } });
    }, reject);
  });
  input.onEvent({ status: "ready", message: "Real repository preview ready.", url });
  return url;
}

export async function readLiveSource(path: string) {
  safeRepositoryPath(path);
  const instance = await container();
  if (!activeWorkspace) throw new Error("Start the live repository preview first.");
  return instance.fs.readFile(`/workspaces/${activeWorkspace}/${path}`, "utf-8");
}

export async function writeLiveSource(path: string, content: string) {
  safeRepositoryPath(path);
  if (/^\.github\/workflows\//i.test(path)) throw new Error("Workflow files cannot be changed by Design Harness.");
  const instance = await container();
  if (!activeWorkspace) throw new Error("Start the live repository preview first.");
  const fullPath = `/workspaces/${activeWorkspace}/${path}`;
  const parent = fullPath.split("/").slice(0, -1).join("/");
  await instance.fs.mkdir(parent, { recursive: true });
  await instance.fs.writeFile(fullPath, content);
}

export async function stopLiveRepositoryPreview() {
  if (activeProcess) { activeProcess.kill(); activeProcess = null; }
  if (containerPromise && activeWorkspace) {
    const instance = await containerPromise;
    await instance.fs.rm(`/workspaces/${activeWorkspace}`, { recursive: true, force: true });
    activeWorkspace = "";
  }
}
