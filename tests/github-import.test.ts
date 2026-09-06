import assert from "node:assert/strict";
import test from "node:test";
import { boundedResponseText, chooseInspectionPaths, GitHubImportError, inspectGitHubRepository } from "../lib/github-import";

const sha = "b".repeat(40);
const repo = { full_name: "example/frontend", html_url: "https://github.com/example/frontend", private: true, default_branch: "feature/design" };

test("missing GitHub credentials make zero network requests", async t => {
  const requests = t.mock.method(globalThis, "fetch", async () => { throw new Error("Must not call GitHub"); });
  await assert.rejects(inspectGitHubRepository("example", "frontend", ""), error => error instanceof GitHubImportError && error.status === 409 && error.needsGitHubApp);
  assert.equal(requests.mock.callCount(), 0);
});

test("private import reads every file and tree at a single SHA, with two source requests maximum", async t => {
  const urls: string[] = [];
  let active = 0;
  let peak = 0;
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    urls.push(url);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-fixture-token");
    if (url.endsWith("/frontend")) return Response.json(repo);
    if (url.includes("/branches/")) {
      assert.ok(url.endsWith("feature%2Fdesign"));
      return Response.json({ commit: { sha } });
    }
    if (url.includes("/git/trees/")) {
      assert.ok(url.endsWith(`${sha}?recursive=1`));
      return Response.json({ truncated: false, tree: ["src/app/page.tsx", "brand.md", "design.md", "styles/theme.css", "src/App.tsx"].map(path => ({ type: "blob", path })) });
    }
    assert.equal(new Headers(init?.headers).get("accept"), "application/vnd.github.raw+json");
    assert.ok(url.endsWith(`?ref=${sha}`));
    active++;
    peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 5));
    active--;
    return new Response("source fixture");
  });
  const result = await inspectGitHubRepository("example", "frontend", "test-fixture-token");
  assert.equal(result.baseSha, sha);
  assert.equal(result.repo.private, true);
  assert.equal(result.brandFiles.length, 3);
  assert.equal(result.routeFiles[0].path, "src/App.tsx");
  assert.equal(peak, 2);
  assert.equal(urls.some(url => url.includes("raw.githubusercontent.com")), false);
});

test("truncated trees fail instead of presenting missing routes as a complete import", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/frontend")) return Response.json(repo);
    if (url.includes("/branches/")) return Response.json({ commit: { sha } });
    return Response.json({ truncated: true, tree: [] });
  });
  await assert.rejects(inspectGitHubRepository("example", "frontend", "test"), error => error instanceof GitHubImportError && error.status === 422);
});

test("rate limiting is distinct from denied access and never echoes upstream content", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("sensitive upstream diagnostics", { status: 403, headers: { "x-ratelimit-remaining": "0", "retry-after": "90" } }));
  await assert.rejects(inspectGitHubRepository("example", "frontend", "test"), error => {
    assert.ok(error instanceof GitHubImportError);
    assert.equal(error.status, 429);
    assert.equal(error.retryAfter, 90);
    assert.equal(error.needsGitHubApp, false);
    assert.equal(error.message.includes("sensitive"), false);
    return true;
  });
});

test("denied repository permissions explain the GitHub App installation requirement", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("Forbidden", { status: 403 }));
  await assert.rejects(inspectGitHubRepository("example", "frontend", "test"), error => error instanceof GitHubImportError && error.status === 403 && error.needsGitHubApp);
});

test("document rules have priority over style files in the bounded brand extraction", () => {
  const selected = chooseInspectionPaths([...Array.from({ length: 20 }, (_, i) => `theme-${i}.css`), "docs/DESIGN.md", "Brand.md", "src/App.tsx"]);
  assert.equal(selected.brandPaths.length, 10);
  assert.deepEqual(selected.brandPaths.slice(0, 2), ["Brand.md", "docs/DESIGN.md"]);
  assert.deepEqual(selected.routePaths, ["src/App.tsx"]);
});

test("source response limits count bytes even without Content-Length", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new TextEncoder().encode("🙂")); },
    cancel() { cancelled = true; },
  });
  await assert.rejects(boundedResponseText(new Response(stream), 6), error => error instanceof GitHubImportError && error.status === 413);
  assert.equal(cancelled, true);
  assert.equal(await boundedResponseText(new Response("small"), 5), "small");
});
