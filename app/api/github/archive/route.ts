import { NextRequest } from "next/server";
import { z } from "zod";
import { parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { githubAppFromRequest, githubInstallationFromRequest, installationAccessToken } from "../../../../lib/github-app";
import { requestUser, sameOrigin } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

const querySchema = z.object({ repositoryUrl: z.string().url(), ref: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/) });
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

function githubHeaders(token?: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "design-harness" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Archive requests must originate from this Site." }, { status: 403 });
    const user = requestUser(request);
    if (!user) return Response.json({ error: "Sign in before downloading a repository archive." }, { status: 401 });
    const input = querySchema.parse({ repositoryUrl: request.nextUrl.searchParams.get("repositoryUrl"), ref: request.nextUrl.searchParams.get("ref") });
    const { owner, repository } = parseGitHubRepositoryUrl(input.repositoryUrl);
    const app = await githubAppFromRequest(request, user);
    const installation = await githubInstallationFromRequest(request, user);
    const token = app && installation ? (await installationAccessToken(installation.installationId, repository, app, "read")).token : undefined;
    const upstream = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zipball/${encodeURIComponent(input.ref)}`, { headers: githubHeaders(token), redirect: "follow" });
    if (!upstream.ok || !upstream.body) return Response.json({ error: upstream.status === 404 ? "Repository archive not found. Install the GitHub App for this repository." : `GitHub archive download failed (${upstream.status}).`, needsGitHubApp: upstream.status === 403 || upstream.status === 404 }, { status: upstream.status === 404 ? 404 : upstream.status === 403 ? 403 : 502 });
    const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ARCHIVE_BYTES) return Response.json({ error: "Repository archive exceeds the 25 MB live-preview limit." }, { status: 413 });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return Response.json({ error: "Repository archive exceeds the 25 MB live-preview limit." }, { status: 413 });
    return new Response(bytes, { headers: { "Content-Type": "application/zip", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download the repository archive." }, { status: 400 });
  }
}
