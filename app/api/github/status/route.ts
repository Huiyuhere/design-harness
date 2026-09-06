import { NextRequest, NextResponse } from "next/server";
import { clearGitHubCookie, githubAppFromRequest, githubInstallationCookie, githubInstallationFromRequest, verifyGitHubInstallation } from "../../../../lib/github-app";
import { jsonError, requestUser, sameOrigin } from "../../../../lib/request-security";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in to connect GitHub.", 401);
  const app = await githubAppFromRequest(request, user);
  const installation = await githubInstallationFromRequest(request, user);
  const headers = new Headers({ "Cache-Control": "private, no-store" });
  let verified = installation;
  let connectionError: string | undefined;
  if (app && installation && (!installation.verifiedAt || !Number.isFinite(Date.parse(installation.verifiedAt)) || Date.now() - Date.parse(installation.verifiedAt) > 300_000 || installation.appId !== app.appId)) {
    try {
      verified = { ...installation, ...await verifyGitHubInstallation(installation.installationId, app) };
      headers.append("Set-Cookie", await githubInstallationCookie(verified, user));
    } catch {
      verified = null;
      connectionError = "GitHub could not verify the installation. Reconnect before importing.";
    }
  }
  return NextResponse.json({
    configured: Boolean(app),
    connected: Boolean(app && verified),
    setupAvailable: Boolean(process.env.API_KEY_ENCRYPTION_KEY),
    connectedAt: verified?.connectedAt ?? null,
    verifiedAt: verified?.verifiedAt ?? null,
    error: connectionError,
    appId: app ? `${app.appId.slice(0, 3)}…` : null,
    permissions: { metadata: "read", contents: verified?.permissions?.contents ?? "unverified", pullRequests: verified?.permissions?.pullRequests ?? "unverified", workflows: "none" },
    tokenPolicy: "Imports mint read-only installation tokens. Publishing mints a separate write token after explicit approval. Tokens expire after one hour.",
  }, { headers });
}

export async function DELETE(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in to manage GitHub.", 401);
  if (!sameOrigin(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  return NextResponse.json({ connected: false }, { headers: { "Set-Cookie": clearGitHubCookie(), "Cache-Control": "no-store" } });
}
