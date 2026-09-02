import { NextRequest } from "next/server";
import { z } from "zod";
import { parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { sameOrigin } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

const querySchema = z.object({ repositoryUrl: z.string().url(), ref: z.string().regex(/^[A-Za-z0-9._/-]{1,200}$/) });
const MAX_ARCHIVE_BYTES = 25 * 1024 * 1024;

function githubHeaders() {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agent-harness" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

export async function GET(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return Response.json({ error: "Archive requests must originate from this Site." }, { status: 403 });
    const input = querySchema.parse({ repositoryUrl: request.nextUrl.searchParams.get("repositoryUrl"), ref: request.nextUrl.searchParams.get("ref") });
    const { owner, repository } = parseGitHubRepositoryUrl(input.repositoryUrl);
    const upstream = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zipball/${encodeURIComponent(input.ref)}`, { headers: githubHeaders(), redirect: "follow" });
    if (!upstream.ok || !upstream.body) return Response.json({ error: upstream.status === 404 ? "Repository archive not found. Private repositories require the GitHub App." : `GitHub archive download failed (${upstream.status}).` }, { status: upstream.status === 404 ? 404 : 502 });
    const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ARCHIVE_BYTES) return Response.json({ error: "Repository archive exceeds the 25 MB live-preview limit." }, { status: 413 });
    const bytes = new Uint8Array(await upstream.arrayBuffer());
    if (bytes.byteLength > MAX_ARCHIVE_BYTES) return Response.json({ error: "Repository archive exceeds the 25 MB live-preview limit." }, { status: 413 });
    return new Response(bytes, { headers: { "Content-Type": "application/zip", "Content-Length": String(bytes.byteLength), "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to download the repository archive." }, { status: 400 });
  }
}
