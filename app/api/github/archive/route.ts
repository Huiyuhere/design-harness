import { NextRequest } from "next/server";
import { z } from "zod";
import { parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { githubAppFromRequest, githubInstallationFromRequest, installationAccessToken } from "../../../../lib/github-app";
import { requestUser, sameOrigin } from "../../../../lib/request-security";
import { MAX_ARCHIVE_BYTES, boundedStream } from "../../../../lib/archive-policy";
import { COMMIT_SHA, fetchGitHubArchive, GitHubImportError } from "../../../../lib/github-import";

export const dynamic = "force-dynamic";

const querySchema = z.object({ repositoryUrl: z.string().url(), ref: z.string().regex(COMMIT_SHA) });
const privateHeaders = { "Cache-Control": "private, no-store" };

export async function GET(request: NextRequest) {
  try {
    // Browsers normally omit Origin on same-origin GET fetches. Fetch Metadata
    // provides the same-origin proof for this read-only endpoint.
    if (!sameOrigin(request) && request.headers.get("sec-fetch-site") !== "same-origin") return Response.json({ error: "Archive requests must originate from this Site." }, { status: 403, headers: privateHeaders });
    const user = requestUser(request);
    if (!user) return Response.json({ error: "Sign in before downloading a repository archive." }, { status: 401, headers: privateHeaders });
    const input = querySchema.parse({ repositoryUrl: request.nextUrl.searchParams.get("repositoryUrl"), ref: request.nextUrl.searchParams.get("ref") });
    const { owner, repository } = parseGitHubRepositoryUrl(input.repositoryUrl);
    const app = await githubAppFromRequest(request, user);
    const installation = await githubInstallationFromRequest(request, user);
    if (!app || !installation) return Response.json({ error: "Connect the Design Harness GitHub App and select this repository before downloading.", needsGitHubApp: true }, { status: 409, headers: { "Cache-Control": "private, no-store" } });
    const { token } = await installationAccessToken(installation.installationId, repository, app, "read");
    const upstream = await fetchGitHubArchive(owner, repository, input.ref, token, request.signal);
    if (!upstream.body) throw new GitHubImportError("GitHub returned an empty repository archive. Retry later.");
    const declaredSize = Number(upstream.headers.get("content-length") ?? 0);
    if (declaredSize > MAX_ARCHIVE_BYTES) { await upstream.body.cancel(); return Response.json({ error: "Repository archive exceeds the 128 MiB live-preview transfer limit." }, { status: 413, headers: privateHeaders }); }
    // Never buffer an entire private repository in the 128 MiB Worker isolate.
    return new Response(boundedStream(upstream.body), { headers: { "Content-Type": "application/zip", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) {
    if (error instanceof GitHubImportError) return Response.json({ error: error.message, needsGitHubApp: error.needsGitHubApp, retryAfter: error.retryAfter }, { status: error.status, headers: { ...privateHeaders, ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    if (error instanceof z.ZodError) return Response.json({ error: "Select an imported repository at its full Git commit SHA before downloading." }, { status: 400, headers: privateHeaders });
    if (error instanceof Error && error.name === "TimeoutError") return Response.json({ error: "GitHub archive download timed out. Retry after checking the connection and repository size." }, { status: 504, headers: privateHeaders });
    if (request.signal.aborted) return Response.json({ error: "Repository download was cancelled." }, { status: 408, headers: privateHeaders });
    // Never reflect fetch errors, repository content, or token diagnostics.
    return Response.json({ error: "Unable to download this repository archive. Check the repository URL and connection, then retry." }, { status: 502, headers: privateHeaders });
  }
}
