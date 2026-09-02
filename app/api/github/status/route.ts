import { NextRequest, NextResponse } from "next/server";
import { clearGitHubCookie, githubAppConfigured, githubInstallationFromRequest } from "../../../../lib/github-app";
import { jsonError, requestUser, sameOrigin } from "../../../../lib/request-security";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in to connect GitHub.", 401);
  const appId = process.env.GITHUB_APP_ID;
  const installation = await githubInstallationFromRequest(request, user);
  return NextResponse.json({
    configured: githubAppConfigured(),
    connected: Boolean(installation),
    connectedAt: installation?.connectedAt ?? null,
    appId: appId ? `${appId.slice(0, 3)}…` : null,
    permissions: { metadata: "read", contents: "write", pullRequests: "write", workflows: "none" },
    tokenPolicy: "Imports mint read-only installation tokens. Publishing mints a separate write token after explicit approval. Tokens expire after one hour.",
  });
}

export async function DELETE(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in to manage GitHub.", 401);
  if (!sameOrigin(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  return NextResponse.json({ connected: false }, { headers: { "Set-Cookie": clearGitHubCookie(), "Cache-Control": "no-store" } });
}
