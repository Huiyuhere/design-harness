import assert from "node:assert/strict";
import test from "node:test";
import { githubAppCookie, githubAppFromRequest, githubInstallationCookie, githubInstallationFromRequest, githubManifest, githubState, verifyGitHubState } from "../lib/github-app";

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
  const configuration = { appId: "98765", slug: "design-harness-designer", privateKey: "-----BEGIN PRIVATE KEY-----\ntest-key-material\n-----END PRIVATE KEY-----", createdAt: "2026-09-02T00:00:00.000Z" };
  const sealed = await githubAppCookie(configuration, user);
  const request = new Request("https://example.test/api/github/status", { headers: { cookie: sealed.split(";")[0] } });
  assert.deepEqual(await githubAppFromRequest(request, user), configuration);
  assert.equal(await githubAppFromRequest(request, { ...user, userId: "someone-else" }), null);
  assert.equal(sealed.includes("test-key-material"), false);
});

test("GitHub App manifest is private, repository-scoped, and has no workflow permission", () => {
  const manifest = githubManifest("https://design.example", user, "state-token");
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_permissions, { contents: "write", pull_requests: "write" });
  assert.deepEqual(manifest.default_events, []);
  assert.equal("workflows" in manifest.default_permissions, false);
  assert.equal(manifest.redirect_url, "https://design.example/api/github/manifest/callback?state=state-token");
});
