import { NextRequest } from "next/server";
import { githubAppConfigured, githubState } from "../../../../lib/github-app";
import { jsonError, requestUser, withinRateLimit } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before connecting GitHub.", 401);
  if (!withinRateLimit(`github-install:${user.userId}`, 6, 60_000)) return jsonError("Too many GitHub connection attempts. Try again in a minute.", 429);
  if (!githubAppConfigured()) return jsonError("The Design Harness GitHub App has not been configured for this deployment.", 503);
  const slug = process.env.GITHUB_APP_SLUG!;
  const { state, cookie } = await githubState(user);
  const location = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
  return new Response(null, { status: 302, headers: { Location: location, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
