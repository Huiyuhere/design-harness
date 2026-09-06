import { NextRequest } from "next/server";
import { clearGitHubCookie, GITHUB_STATE_COOKIE, githubAppFromRequest, githubInstallationCookie, verifyGitHubInstallation, verifyGitHubState } from "../../../../lib/github-app";
import { jsonError, requestUser, sameOrigin } from "../../../../lib/request-security";
import { boundedResponseText, GitHubImportError } from "../../../../lib/github-import";
import { githubReturnPage } from "../../../../lib/github-return-page";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before completing the GitHub connection.", 401);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const installationId = Number(request.nextUrl.searchParams.get("installation_id"));
  if (!state || !Number.isSafeInteger(installationId) || installationId < 1 || !(await verifyGitHubState(request, user, state))) return jsonError("The GitHub installation callback was invalid or expired. Start the connection again.", 403);
  return githubReturnPage({ title: "Finish connecting GitHub", description: "Confirm the connection to verify this App installation and return to your canvas. This does not edit or publish repository code.", label: "Verify connection and return to canvas", action: "/api/github/callback", fields: { state, installation_id: String(installationId) } });
}

export async function POST(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before completing the GitHub connection.", 401);
  if (!sameOrigin(request)) return jsonError("Cross-origin GitHub connection requests are not allowed.", 403);
  try {
  const data = new URLSearchParams(await boundedResponseText(new Response(request.body), 4096));
  const state = data.get("state") ?? "";
  const installationId = Number(data.get("installation_id"));
  if (!state || !Number.isSafeInteger(installationId) || installationId < 1 || !(await verifyGitHubState(request, user, state))) return jsonError("The GitHub installation callback was invalid or expired. Start the connection again.", 403);
  const app = await githubAppFromRequest(request, user);
  if (!app) return jsonError("The GitHub App session is missing. Return to Design Harness and start setup again.", 409);
  const verified = await verifyGitHubInstallation(installationId, app);
  const installationCookie = await githubInstallationCookie({ installationId, connectedAt: new Date().toISOString(), ...verified }, user);
  const destination = new URL("/?github=connected", request.nextUrl.origin);
  const headers = new Headers({ Location: destination.toString(), "Cache-Control": "no-store" });
  headers.append("Set-Cookie", installationCookie);
  headers.append("Set-Cookie", clearGitHubCookie(GITHUB_STATE_COOKIE));
  return new Response(null, { status: 303, headers });
  } catch (error) {
    return jsonError(error instanceof GitHubImportError ? error.message : "GitHub verification failed. Return to Design Harness and reconnect the App.", error instanceof GitHubImportError ? error.status : 502, { "Cache-Control": "private, no-store" });
  }
}
