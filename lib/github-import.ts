import { z } from "zod";
import { isBrandSource } from "./brand-extractor";

export const COMMIT_SHA = /^[a-f0-9]{40}$/i;
const MAX_METADATA_BYTES = 2 * 1024 * 1024;
const MAX_TREE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 512 * 1024;

export class GitHubImportError extends Error {
  constructor(message: string, public status = 502, public needsGitHubApp = false, public retryAfter?: number) { super(message); }
}

export function githubHeaders(token: string, raw = false) {
  if (!token) throw new GitHubImportError("Connect the Design Harness GitHub App before importing a repository.", 409, true);
  return { Accept: raw ? "application/vnd.github.raw+json" : "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "design-harness" };
}

async function checkedResponse(url: string, token: string, raw = false, options: { signal?: AbortSignal; timeoutMs?: number } = {}) {
  options.signal?.throwIfAborted();
  const timeout = AbortSignal.timeout(options.timeoutMs ?? 30_000);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const response = await fetch(url, { headers: githubHeaders(token, raw), signal, cache: "no-store", redirect: "follow" });
  if (response.ok) return response;
  await response.body?.cancel();
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const retry = Number(response.headers.get("retry-after"));
  if (response.status === 429 || response.headers.get("x-ratelimit-remaining") === "0" || (response.status === 403 && retry > 0)) {
    const seconds = retry > 0 ? Math.ceil(retry) : reset > 0 ? Math.max(1, Math.ceil(reset - Date.now() / 1000)) : 60;
    throw new GitHubImportError("GitHub has temporarily limited this installation. Wait before retrying; reconnecting will not reset the limit.", 429, false, seconds);
  }
  if (response.status === 401) throw new GitHubImportError("GitHub rejected the installation token. Reconnect the Design Harness GitHub App.", 401, true);
  if (response.status === 404) throw new GitHubImportError("Repository or source not accessible. Check that this exact repository is selected in the GitHub App installation.", 404, true);
  if (response.status === 403) throw new GitHubImportError("GitHub denied access. Check the installation's selected repositories and any organization approval requirements.", 403, true);
  throw new GitHubImportError(`GitHub could not complete the import (${response.status}). Retry later.`, 502);
}

/** Same error semantics as discovery; the archive body remains a stream. */
export function fetchGitHubArchive(owner: string, repository: string, sha: string, token: string, signal?: AbortSignal) {
  if (!COMMIT_SHA.test(sha)) throw new GitHubImportError("Select an exact Git commit before downloading.", 400);
  return checkedResponse(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zipball/${sha}`, token, false, { signal, timeoutMs: 120_000 });
}

// Count bytes while reading, not after allocating an unbounded response string.
export async function boundedResponseText(response: Response, limit: number) {
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    await response.body?.cancel();
    throw new GitHubImportError("Repository metadata or source exceeds the inspection size limit.", 413);
  }
  const reader = response.body?.getReader();
  if (!reader) throw new GitHubImportError("GitHub returned an empty response.");
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new GitHubImportError("Repository metadata or source exceeds the inspection size limit.", 413);
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

async function githubJson(url: string, token: string, limit = MAX_METADATA_BYTES) {
  const text = await boundedResponseText(await checkedResponse(url, token), limit);
  try { return JSON.parse(text); } catch { throw new GitHubImportError("GitHub returned malformed repository metadata."); }
}

export function chooseInspectionPaths(paths: string[]) {
  const priority = (path: string) => /(?:^|\/)(?:brand|design)\.md$/i.test(path) ? 0 : /brand|token|theme/i.test(path) ? 1 : /global|variable/i.test(path) ? 2 : 3;
  const brandPaths = paths.filter(isBrandSource).sort((a, b) => priority(a) - priority(b) || a.length - b.length || a.localeCompare(b)).slice(0, 10);
  const routePaths = paths.filter(path => /(?:^|\/)(?:App|router|routes|registry)\.(?:t|j)sx?$|surface-inventory\.json$/i.test(path)).slice(0, 12);
  return { brandPaths, routePaths };
}

const repositorySchema = z.object({ full_name: z.string(), html_url: z.string().url(), private: z.boolean(), default_branch: z.string().min(1) });
const branchSchema = z.object({ commit: z.object({ sha: z.string().regex(COMMIT_SHA) }) });
const treeSchema = z.object({ truncated: z.boolean(), tree: z.array(z.object({ path: z.string(), type: z.string() })) });

export async function inspectGitHubRepository(owner: string, repository: string, token: string) {
  // Fail before any network request; never quietly use the shared anonymous quota.
  githubHeaders(token);
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`;
  const repo = repositorySchema.parse(await githubJson(base, token));
  const branch = branchSchema.parse(await githubJson(`${base}/branches/${encodeURIComponent(repo.default_branch)}`, token));
  const baseSha = branch.commit.sha;
  // Pin discovery and every inspected file to the same revision as the archive.
  // A branch moving during import must not mix two versions of the application.
  const tree = treeSchema.parse(await githubJson(`${base}/git/trees/${baseSha}?recursive=1`, token, MAX_TREE_BYTES));
  if (tree.truncated) throw new GitHubImportError("GitHub truncated this repository's file list. Import stopped so missing routes are not presented as a complete canvas.", 422);
  const paths = tree.tree.filter(item => item.type === "blob").map(item => item.path);
  const { brandPaths, routePaths } = chooseInspectionPaths(paths);
  const queue = [...new Set([...brandPaths, ...routePaths])];
  const files = new Map<string, { path: string; content: string }>();
  const diagnostics: string[] = [];
  // At most two file requests at a time; do not burst 22 requests per import.
  let next = 0;
  let failure: unknown;
  await Promise.all([0, 1].map(async () => {
    while (!failure && next < queue.length) {
      const path = queue[next++];
      try {
        const encodedPath = path.split("/").map(encodeURIComponent).join("/");
        const response = await checkedResponse(`${base}/contents/${encodedPath}?ref=${baseSha}`, token, true);
        files.set(path, { path, content: await boundedResponseText(response, MAX_SOURCE_BYTES) });
      } catch (error) {
        if (error instanceof GitHubImportError && error.status === 413) diagnostics.push(`Not inspected: ${path} exceeds 512 KiB. Review this source in the loaded workspace.`);
        else failure = error;
      }
    }
  }));
  if (failure) throw failure;
  const select = (selected: string[]) => selected.flatMap(path => files.has(path) ? [files.get(path)!] : []);
  return { repo, baseSha, paths, brandFiles: select(brandPaths), routeFiles: select(routePaths), diagnostics };
}
