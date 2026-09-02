import { NextRequest } from "next/server";
import { clearGitHubCookie, GITHUB_STATE_COOKIE, githubInstallationCookie, verifyGitHubState } from "../../../../lib/github-app";
import { jsonError, requestUser } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before completing the GitHub connection.", 401);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const installationId = Number(request.nextUrl.searchParams.get("installation_id"));
  if (!state || !Number.isSafeInteger(installationId) || installationId < 1 || !(await verifyGitHubState(request, user, state))) return jsonError("The GitHub installation callback was invalid or expired. Start the connection again.", 403);
  const installationCookie = await githubInstallationCookie({ installationId, connectedAt: new Date().toISOString() }, user);
  const destination = new URL("/?github=connected", request.nextUrl.origin);
  const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", installationCookie);
  headers.append("Set-Cookie", clearGitHubCookie(GITHUB_STATE_COOKIE));
  return new Response(null, { status: 302, headers });
}
