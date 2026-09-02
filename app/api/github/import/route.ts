import { NextRequest } from "next/server";
import { z } from "zod";
import { extractBrandTokens, isBrandSource, parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { discoverFileRoutes, discoverSourceRoutes } from "../../../../lib/route-discovery";
import { brandDocuments } from "../../../../lib/brand-documents";
import { githubInstallationFromRequest, installationAccessToken } from "../../../../lib/github-app";
import { jsonError, requestUser, sameOrigin } from "../../../../lib/request-security";

export const dynamic = "force-dynamic";

const schema = z.object({ repositoryUrl: z.string().url() });

function githubHeaders(token?: string) {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "design-harness" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson(url: string, token?: string) {
  const response = await fetch(url, { headers: githubHeaders(token) });
  if (response.status === 404) throw new Error("Repository not found. Private repositories require the Design Harness GitHub App.");
  if (!response.ok) {
    const reset = Number(response.headers.get("x-ratelimit-reset"));
    const resetText = Number.isFinite(reset) ? ` Try again after ${new Date(reset * 1000).toLocaleTimeString()}.` : "";
    throw new Error(`GitHub returned ${response.status}.${resetText} Connect the Design Harness GitHub App to use repository-scoped authentication.`);
  }
  return response.json();
}

async function readRawFile(owner: string, repository: string, branch: string, path: string, token?: string) {
  const raw = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!raw.ok) return null;
  return { path, content: (await raw.text()).slice(0, 250_000) };
}

export async function POST(request: NextRequest) {
  try {
    const user = requestUser(request);
    if (!user) return jsonError("Sign in before importing a repository.", 401);
    if (!sameOrigin(request)) return jsonError("Cross-origin repository imports are not allowed.", 403);
    const body = schema.parse(await request.json());
    const { owner, repository } = parseGitHubRepositoryUrl(body.repositoryUrl);
    const installation = await githubInstallationFromRequest(request, user);
    const token = installation ? (await installationAccessToken(installation.installationId, repository, "read")).token : undefined;
    const repo = await githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`, token);
    const [branch, tree] = await Promise.all([
      githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(repo.default_branch)}`, token),
      githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`, token),
    ]);
    const paths = (tree.tree as Array<{ path: string; type: string }>).filter((item) => item.type === "blob").map((item) => item.path);
    const brandPaths = paths.filter(isBrandSource).sort((a, b) => {
      const score = (path: string) => (/brand|token|theme/i.test(path) ? 0 : /global|variable/i.test(path) ? 1 : 2);
      return score(a) - score(b) || a.length - b.length;
    }).slice(0, 10);
    const routePaths = paths.filter((path) => /(?:^|\/)(?:App|router|routes|registry)\.(?:t|j)sx?$|surface-inventory\.json$/i.test(path)).slice(0, 12);
    const [brandFiles, routeFiles] = await Promise.all([
      Promise.all(brandPaths.map((path) => readRawFile(owner, repository, repo.default_branch, path, token))),
      Promise.all(routePaths.map((path) => readRawFile(owner, repository, repo.default_branch, path, token))),
    ]);
    const readableBrandFiles = brandFiles.filter((file): file is { path: string; content: string } => Boolean(file));
    const readableRouteFiles = routeFiles.filter((file): file is { path: string; content: string } => Boolean(file));
    const discoveredRoutes = [...discoverFileRoutes(paths), ...discoverSourceRoutes(readableRouteFiles)];
    const uniqueRoutes = [...new Map(discoveredRoutes.map((route) => [route.route, route])).values()];
    if (!uniqueRoutes.length && paths.some((path) => /(?:^|\/)vite\.config\.(?:t|j)s$/.test(path))) uniqueRoutes.push({ route: "/", file: paths.find((path) => /(?:^|\/)src\/App\.(?:t|j)sx$/.test(path)) ?? "src/App.tsx", dynamic: false, framework: "react-router" });
    const extractedBrand = extractBrandTokens(readableBrandFiles);
    extractedBrand.documents = await brandDocuments(readableBrandFiles);
    return Response.json({
      repository: { owner, name: repository, fullName: repo.full_name, url: repo.html_url, private: repo.private, defaultBranch: repo.default_branch, baseSha: branch.commit.sha },
      routes: uniqueRoutes.map((route) => ({ ...route, fixtureRequired: route.dynamic })),
      brand: extractedBrand,
      trustRequired: true,
      scriptsExecuted: false,
      executionBoundary: "Frontend source only. Design Harness does not provision databases, authentication servers, API services, or repository backends; use deterministic fixtures for routes that depend on them.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inspect that repository.";
    const githubBlocked = /GitHub returned 403|rate|GitHub App token|installation/i.test(message);
    return Response.json({ error: message, needsGitHubApp: githubBlocked }, { status: /not found|private/i.test(message) ? 404 : githubBlocked ? 403 : 400 });
  }
}
