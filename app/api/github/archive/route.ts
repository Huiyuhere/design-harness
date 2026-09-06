import { NextRequest } from "next/server";
import { z } from "zod";
import { parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { githubAppFromRequest, githubInstallationFromRequest, installationAccessToken } from "../../../../lib/github-app";
import { requestUser, sameOrigin } from "../../../../lib/request-security";
import { MAX_ARCHIVE_BYTES, boundedStream } from "../../../../lib/archive-policy";
import { COMMIT_SHA, githubHeaders } from "../../../../lib/github-import";

export const dynamic = "force-dynamic";

const querySchema = z.object({ repositoryUrl: z.string().url(), ref: z.string().regex(COMMIT_SHA) });

export async function GET(request: NextRequest) {
  try {
    // Browsers normally omit Origin on same-origin GET fetches. Fetch Metadata
    // provides the same-origin proof for this read-only endpoint.
    if (!sameOrigin(request) && request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "Archive requests must originate from this Site." }, { status: 403 });
    const user = requestUser(request);
    if (!user) return Response.json({ error: "Sign in before downloading a repository archive." }, { status: 401 });
    const input = querySchema.parse({ repositoryUrl: request.nextUrl.searchParams.get("repositoryUrl"), ref: request.nextUrl.searchParams.get("ref") });
    const { owner, repository } = parseGitHubRepositoryUrl(input.repositoryUrl);
    const app = await githubAppFromRequest(request, user);
    const installation = await githubInstallationFromRequest(request, user);
    if (!app || !installation) return Response.json({ error: "Connect the Design Harness GitHub App and select this repository before downloading.", needsGitHubApp: true }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    const { token } = await installationAccessToken(installation.installationId, repository, app, "read");
    const upstream = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/zipball/${encodeURIComponent(input.ref)}`, { headers: githubHeaders(token), redirect: "follow" });
    if (!upstream.ok || !upstream.body) return Response.json({ error: upstream.status === 404 ? "Repository archive not found. Install the GitHub App for this repository." : `GitHub archive download failed (${upstream.status}).`, needsGitHubApp: upstream.status === 403 || upstream.status === 404 }, { status: upstream.status === 404 ? 404 : upstream.status === 403 ? 403 : 502 });
    const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ARCHIVE_BYTES) { await upstream.body.cancel(); return Response.json({ error: "Repository archive exceeds the 128 MiB live-preview transfer limit." }, { status: 413 }); }
    // Never buffer an entire private repository in the 128 MiB Worker isolate.
    return new Response(boundedStream(upstream.body), { headers: { "Content-Type": "application/zip", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    return Response.json({ error: error instanceof z.ZodError ? "Select an imported repository at its full Git commit SHA before downloading." : "Unable to download this repository archive. Check the GitHub App connection and retry." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }
}
