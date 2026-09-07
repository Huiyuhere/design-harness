"use client";

import { unzipSync } from "fflate";
import type { FileSystemTree, WebContainer } from "@webcontainer/api";
import { MAX_ARCHIVE_BYTES, MAX_EXPANDED_BYTES, MAX_FILE_BYTES, MAX_ARCHIVE_FILES, safeRepositoryPath, boundedStream } from "./archive-policy";
import { buildPreviewBridge } from './preview-bridge';
import { PreviewSession, type PreviewStart } from './preview-session';
import { browserPreviewDrafts, type SourceChange } from './preview-drafts';
import { PREVIEW_TOOL_ASSET } from './preview-source-tools';

export type { LivePreviewStatus, LivePreviewEvent } from './preview-session';

let containerPromise: Promise<WebContainer> | null = null;

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

async function downloadRepository(input: PreviewStart, signal: AbortSignal) {
  const response = await fetch(`/api/github/archive?repositoryUrl=${encodeURIComponent(input.repositoryUrl)}&ref=${encodeURIComponent(input.ref)}`, { cache: "no-store", signal });
  if (!response.ok) { const payload = await response.json().catch(() => ({ error: "Archive download failed." })) as { error?: string }; throw new Error(payload.error ?? "Archive download failed."); }
  if (!response.body || Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES) throw new Error('Repository exceeds the archive transfer limit.');
  let bytes: Uint8Array;
  try { bytes = new Uint8Array(await new Response(boundedStream(response.body)).arrayBuffer()); }
  catch (error) { if (signal.aborted) throw error; throw new Error("Archive transfer was interrupted or exceeded its limit. Retry after checking repository size and connection."); }
  signal.throwIfAborted(); return repositoryArchiveToTree(bytes);
}

export async function loadPreviewSourceTool(signal: AbortSignal) {
  const response = await fetch(PREVIEW_TOOL_ASSET, { signal });
  if (!response.ok || !response.body) throw new Error('Preview source tools are unavailable. Reload Design Harness.');
  return new Response(boundedStream(response.body, 2 * 1024 * 1024)).text();
}
const session = new PreviewSession({ boot: container, download: downloadRepository, bridge: () => buildPreviewBridge(location.origin), drafts: browserPreviewDrafts, sourceTool: loadPreviewSourceTool });
export const startLiveRepositoryPreview = (input: PreviewStart) => session.start(input);
export const stopLiveRepositoryPreview = () => session.stop();
export const readLiveSource = (workspaceId: string, path: string) => session.read(workspaceId, path);
export const writeLiveSource = (workspaceId: string, path: string, content: string, expected: string | null) => session.apply(workspaceId, [{ path, before: expected, after: content }]);
export const applyLiveSourceChanges = (workspaceId: string, changes: SourceChange[], validate?: (signal: AbortSignal) => Promise<void>) => session.apply(workspaceId, changes, validate);
export const getLivePreviewDiagnostics = (workspaceId: string) => session.diagnostics(workspaceId);
