import assert from "node:assert/strict";
import test from "node:test";
import { githubInstallationCookie, githubInstallationFromRequest, githubState, verifyGitHubState } from "../lib/github-app";

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
