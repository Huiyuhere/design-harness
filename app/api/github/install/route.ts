import { NextRequest } from "next/server";
import { githubAppFromRequest, githubState } from "../../../../lib/github-app";
import { jsonError, requestUser, withinRateLimit } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before connecting GitHub.", 401);
  if (!withinRateLimit(`github-install:${user.userId}`, 6, 60_000)) return jsonError("Too many GitHub connection attempts. Try again in a minute.", 429);
  const app = await githubAppFromRequest(request, user);
  if (!app) return new Response(null, { status: 302, headers: { Location: new URL("/api/github/manifest", request.nextUrl.origin).toString(), "Cache-Control": "no-store" } });
  const slug = app.slug;
  const { state, cookie } = await githubState(user);
  const location = `https://github.com/apps/${encodeURIComponent(slug)}/installations/new?state=${encodeURIComponent(state)}`;
  return new Response(null, { status: 302, headers: { Location: location, "Set-Cookie": cookie, "Cache-Control": "no-store" } });
}
