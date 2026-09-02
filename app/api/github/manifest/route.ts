import { NextRequest } from "next/server";
import { githubManifest, githubState } from "../../../../lib/github-app";
import { jsonError, requestUser, withinRateLimit } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}

export async function GET(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before creating a GitHub App.", 401);
  if (!process.env.API_KEY_ENCRYPTION_KEY) return jsonError("Secure GitHub App setup is unavailable for this deployment.", 503);
  if (!withinRateLimit(`github-manifest:${user.userId}`, 4, 60_000)) return jsonError("Too many GitHub setup attempts. Try again in a minute.", 429);
  const { state, cookie } = await githubState(user);
  const manifest = escapeHtml(JSON.stringify(githubManifest(request.nextUrl.origin, user, state)));
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Design Harness to GitHub</title><style>body{font:16px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:#f7f7f4;color:#202225}.card{width:min(440px,calc(100vw - 40px));padding:28px;border:1px solid #d7d7d2;border-radius:18px;background:white;box-shadow:0 18px 60px #0001}h1{font-size:24px;margin:0 0 8px}p{color:#666;line-height:1.5}button{border:0;border-radius:9px;background:#202225;color:white;padding:12px 16px;font-weight:700}</style></head><body><form class="card" method="post" action="https://github.com/settings/apps/new?state=${encodeURIComponent(state)}"><h1>Create your Design Harness GitHub App</h1><p>GitHub will show the exact repository permissions before creating this private App. No personal token is requested.</p><input type="hidden" name="manifest" value="${manifest}"><button type="submit">Continue to GitHub</button></form><script>document.forms[0].submit()</script></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; form-action https://github.com; base-uri 'none'; frame-ancestors 'none'", "Set-Cookie": cookie } });
}
