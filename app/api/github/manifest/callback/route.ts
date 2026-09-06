import { NextRequest } from "next/server";
import { clearGitHubCookie, GITHUB_STATE_COOKIE, githubAppCookie, verifyGitHubState } from "../../../../../lib/github-app";
import { jsonError, requestUser } from "../../../../../lib/request-security";
import { githubReturnPage } from "../../../../../lib/github-return-page";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before completing GitHub App setup.", 401);
  const state = request.nextUrl.searchParams.get("state") ?? "";
  const code = request.nextUrl.searchParams.get("code") ?? "";
  if (!/^[A-Za-z0-9_-]{10,200}$/.test(code) || !state || !(await verifyGitHubState(request, user, state))) return jsonError("The GitHub App setup callback was invalid or expired. Start setup again.", 403);
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "User-Agent": "design-harness", "X-GitHub-Api-Version": "2022-11-28" },
  });
  const payload = await response.json().catch(() => null) as { id?: number; slug?: string; pem?: string; message?: string } | null;
  if (!response.ok || !payload?.id || !payload.slug || !payload.pem) return jsonError(payload?.message ?? "GitHub could not create the App.", response.status || 502);
  if (!/^[a-z0-9-]{1,100}$/.test(payload.slug) || payload.pem.length > 10_000 || !payload.pem.includes("PRIVATE KEY")) return jsonError("GitHub returned an invalid App configuration.", 502);
  const appCookie = await githubAppCookie({ appId: String(payload.id), slug: payload.slug, privateKey: payload.pem, createdAt: new Date().toISOString() }, user);
  const headers = new Headers();
  headers.append("Set-Cookie", appCookie);
  headers.append("Set-Cookie", clearGitHubCookie(GITHUB_STATE_COOKIE));
  return githubReturnPage({ title: "Your GitHub App is ready", description: "Next, install it on only the repositories you want to use in Design Harness. No repository code is changed by connecting.", label: "Choose repositories on GitHub", action: "/api/github/install", headers });
}
