import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync } from "node:crypto";
import { githubAppCookie, githubAppFromRequest, githubInstallationCookie, githubInstallationFromRequest, githubManifest, githubState, installationAccessToken, verifyGitHubInstallation, verifyGitHubState } from "../lib/github-app";
import { githubReturnPage } from "../lib/github-return-page";

const user = { userId: "designer-1", email: "designer@example.com", displayName: "Designer" };
const secret = "test-only-github-session-secret-with-enough-entropy";

test("binds GitHub installation state and sessions to one signed-in user", async () => {
  process.env.API_KEY_ENCRYPTION_KEY = secret;
  const pending = await githubState(user);
  const stateCookie = pending.cookie.split(";")[0];
  const callback = new Request(`https://example.test/api/github/callback?state=${pending.state}`, { headers: { cookie: stateCookie } });
  assert.equal(await verifyGitHubState(callback, user, pending.state), true);
  assert.equal(await verifyGitHubState(callback, { ...user, userId: "someone-else" }, pending.state), false);

  const installationCookie = await githubInstallationCookie({ installationId: 1234, connectedAt: "2026-09-02T00:00:00.000Z" }, user);
  const connected = new Request("https://example.test/api/github/status", { headers: { cookie: installationCookie.split(";")[0] } });
  assert.deepEqual(await githubInstallationFromRequest(connected, user), { installationId: 1234, connectedAt: "2026-09-02T00:00:00.000Z" });
  assert.equal(await githubInstallationFromRequest(connected, { ...user, userId: "someone-else" }), null);
});

test("stores a user-owned GitHub App configuration in an encrypted user-bound cookie", async () => {
  process.env.API_KEY_ENCRYPTION_KEY = secret;
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  const configuration = { appId: "98765", slug: "design-harness-designer", privateKey: "SYNTHETIC PRIVATE KEY test-key-material", createdAt: "2026-09-02T00:00:00.000Z" };
  const sealed = await githubAppCookie(configuration, user);
  const request = new Request("https://example.test/api/github/status", { headers: { cookie: sealed.split(";")[0] } });
  assert.deepEqual(await githubAppFromRequest(request, user), configuration);
  assert.equal(await githubAppFromRequest(request, { ...user, userId: "someone-else" }), null);
  assert.equal(sealed.includes("test-key-material"), false);
});

test("GitHub App manifest is private, repository-scoped, and has no workflow permission", () => {
  const manifest = githubManifest("https://design.example", user);
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_permissions, { contents: "write", pull_requests: "write" });
  assert.deepEqual(manifest.default_events, []);
  assert.equal("workflows" in manifest.default_permissions, false);
  assert.equal(manifest.redirect_url, "https://design.example/api/github/manifest/callback");
  assert.equal(new URL(manifest.redirect_url).search, "");
});

// Synthetic key generated in memory; no user credential enters this fixture.
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const app = { appId: "456", slug: "design-test", privateKey, createdAt: new Date().toISOString() };

test("a real 2048-bit App key fits in a Strict encrypted cookie, oversized keys fail visibly", async () => {
  process.env.API_KEY_ENCRYPTION_KEY = secret;
  const sealed = await githubAppCookie(app, user);
  assert.ok(sealed.length < 4096);
  assert.ok(sealed.includes("SameSite=Strict"));
  assert.ok(sealed.includes("HttpOnly"));
  assert.equal(sealed.includes("PRIVATE KEY"), false);
  await assert.rejects(githubAppCookie({ ...app, privateKey: privateKey.repeat(3) }, user), /exceeds the secure browser-session limit/);
});

test("verifies the exact installation belongs to the correct App and checks permissions", async t => {
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, init?: RequestInit) => {
    assert.equal(String(input), "https://api.github.com/app/installations/123");
    assert.match(new Headers(init?.headers).get("authorization") ?? "", /^Bearer ey/);
    return Response.json({ id: 123, app_id: 456, suspended_at: null, permissions: { contents: "write", pull_requests: "write" } });
  });
  const result = await verifyGitHubInstallation(123, app);
  assert.equal(result.appId, "456");
  assert.deepEqual(result.permissions, { contents: "write", pullRequests: "write" });
  assert.ok(Number.isFinite(Date.parse(result.verifiedAt)));
});

test("rejects wrong, suspended, and unreadable installations before connecting", async t => {
  let payload: object = {};
  t.mock.method(globalThis, "fetch", async () => Response.json(payload));
  for (const value of [
    { id: 999, app_id: 456, permissions: { contents: "read" } },
    { id: 123, app_id: 999, permissions: { contents: "read" } },
    { id: 123, app_id: 456, suspended_at: "2026-01-01", permissions: { contents: "read" } },
    { id: 123, app_id: 456, permissions: {} },
  ]) {
    payload = value;
    await assert.rejects(verifyGitHubInstallation(123, app));
  }
});

test("import tokens are narrowed to a single repository and read-only contents", async t => {
  t.mock.method(globalThis, "fetch", async (_input: string | URL | Request, init?: RequestInit) => {
    assert.deepEqual(JSON.parse(String(init?.body)), { repositories: ["frontend"], permissions: { contents: "read" } });
    return Response.json({ token: "synthetic-fixture-token", expires_at: "2026-09-07T01:00:00Z" });
  });
  const result = await installationAccessToken(123, "frontend", app);
  assert.equal(result.token, "synthetic-fixture-token");
});

test("token failures never reflect an upstream body into the UI", async t => {
  t.mock.method(globalThis, "fetch", async () => new Response("private upstream information", { status: 403 }));
  await assert.rejects(installationAccessToken(123, "frontend", app), error => {
    assert.ok(error instanceof Error);
    assert.equal(error.message.includes("private upstream"), false);
    return true;
  });
});

test("GitHub return requires a first-party confirmation, escapes inputs, and loads no scripts", async () => {
  const response = githubReturnPage({ title: "Connect GitHub", description: "Verify installation", label: "Continue", action: "/api/github/callback", fields: { state: '\"><script>alert(1)</script>', installation_id: "123" } });
  const html = await response.text();
  assert.ok(html.includes('method="post"'));
  assert.equal(html.includes("<script>"), false);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(response.headers.get("content-security-policy")?.includes("form-action 'self'"));
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(response.headers.get("cache-control"), "private, no-store");
});
