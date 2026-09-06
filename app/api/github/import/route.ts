import { NextRequest } from "next/server";
import { z } from "zod";
import { extractBrandTokens, parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { discoverFileRoutes, discoverSourceRoutes } from "../../../../lib/route-discovery";
import { brandDocuments } from "../../../../lib/brand-documents";
import { githubAppFromRequest, githubInstallationFromRequest, installationAccessToken } from "../../../../lib/github-app";
import { jsonError, requestUser, sameOrigin } from "../../../../lib/request-security";
import { GitHubImportError, inspectGitHubRepository } from "../../../../lib/github-import";

export const dynamic = "force-dynamic";

const schema = z.object({ repositoryUrl: z.string().url() });

export async function POST(request: NextRequest) {
  try {
    const user = requestUser(request);
    if (!user) return jsonError("Sign in before importing a repository.", 401);
    if (!sameOrigin(request)) return jsonError("Cross-origin repository imports are not allowed.", 403);
    const body = schema.parse(await request.json());
    const { owner, repository } = parseGitHubRepositoryUrl(body.repositoryUrl);
    const app = await githubAppFromRequest(request, user);
    const installation = await githubInstallationFromRequest(request, user);
    if (!app || !installation) throw new GitHubImportError("Connect the Design Harness GitHub App and select this repository before importing.", 409, true);
    const { token } = await installationAccessToken(installation.installationId, repository, app, "read");
    const { repo, baseSha, paths, brandFiles: readableBrandFiles, routeFiles: readableRouteFiles, diagnostics } = await inspectGitHubRepository(owner, repository, token);
    const discoveredRoutes = [...discoverFileRoutes(paths), ...discoverSourceRoutes(readableRouteFiles)];
    const uniqueRoutes = [...new Map(discoveredRoutes.map((route) => [route.route, route])).values()];
    if (!uniqueRoutes.length && paths.some((path) => /(?:^|\/)vite\.config\.(?:t|j)s$/.test(path))) uniqueRoutes.push({ route: "/", file: paths.find((path) => /(?:^|\/)src\/App\.(?:t|j)sx$/.test(path)) ?? "src/App.tsx", dynamic: false, framework: "react-router" });
    const extractedBrand = extractBrandTokens(readableBrandFiles);
    extractedBrand.documents = await brandDocuments(readableBrandFiles);
    return Response.json({
      repository: { owner, name: repository, fullName: repo.full_name, url: repo.html_url, private: repo.private, defaultBranch: repo.default_branch, baseSha },
      routes: uniqueRoutes.map((route) => ({ ...route, fixtureRequired: route.dynamic })),
      brand: extractedBrand,
      trustRequired: true,
      scriptsExecuted: false,
      diagnostics,
      executionBoundary: "Frontend source only. Design Harness does not provision databases, authentication servers, API services, or repository backends; use deterministic fixtures for routes that depend on them.",
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof GitHubImportError) return Response.json({ error: error.message, needsGitHubApp: error.needsGitHubApp, retryAfter: error.retryAfter }, { status: error.status, headers: { "Cache-Control": "private, no-store", ...(error.retryAfter ? { "Retry-After": String(error.retryAfter) } : {}) } });
    // Never reflect upstream response bodies, tokens, or repository content.
    return jsonError(error instanceof z.ZodError ? "Invalid repository URL or incomplete GitHub metadata." : "Repository import failed. Check the GitHub App connection and try again.", 400, { "Cache-Control": "private, no-store" });
  }
}
