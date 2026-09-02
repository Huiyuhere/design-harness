import { NextRequest } from "next/server";
import { z } from "zod";
import { extractBrandTokens, isBrandSource, parseGitHubRepositoryUrl } from "../../../../lib/brand-extractor";
import { discoverFileRoutes, discoverSourceRoutes } from "../../../../lib/route-discovery";
import { brandDocuments } from "../../../../lib/brand-documents";

export const dynamic = "force-dynamic";

const schema = z.object({ repositoryUrl: z.string().url() });

function githubHeaders() {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "User-Agent": "agent-harness" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  return headers;
}

async function githubJson(url: string) {
  const response = await fetch(url, { headers: githubHeaders() });
  if (response.status === 404) throw new Error("Repository not found. Private repositories require the Design Harness GitHub App.");
  if (!response.ok) throw new Error(`GitHub returned ${response.status}. Try again after checking access or rate limits.`);
  return response.json();
}

async function readRawFile(owner: string, repository: string, branch: string, path: string) {
  const raw = await fetch(`https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/${encodeURIComponent(branch)}/${path.split("/").map(encodeURIComponent).join("/")}`);
  if (!raw.ok) return null;
  return { path, content: (await raw.text()).slice(0, 250_000) };
}

export async function POST(request: NextRequest) {
  try {
    const body = schema.parse(await request.json());
    const { owner, repository } = parseGitHubRepositoryUrl(body.repositoryUrl);
    const repo = await githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}`);
    const [branch, tree] = await Promise.all([
      githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/branches/${encodeURIComponent(repo.default_branch)}`),
      githubJson(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`),
    ]);
    const paths = (tree.tree as Array<{ path: string; type: string }>).filter((item) => item.type === "blob").map((item) => item.path);
    const brandPaths = paths.filter(isBrandSource).sort((a, b) => {
      const score = (path: string) => (/brand|token|theme/i.test(path) ? 0 : /global|variable/i.test(path) ? 1 : 2);
      return score(a) - score(b) || a.length - b.length;
    }).slice(0, 10);
    const routePaths = paths.filter((path) => /(?:^|\/)(?:App|router|routes|registry)\.(?:t|j)sx?$|surface-inventory\.json$/i.test(path)).slice(0, 12);
    const [brandFiles, routeFiles] = await Promise.all([
      Promise.all(brandPaths.map((path) => readRawFile(owner, repository, repo.default_branch, path))),
      Promise.all(routePaths.map((path) => readRawFile(owner, repository, repo.default_branch, path))),
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
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to inspect that repository.";
    return Response.json({ error: message }, { status: /not found|private/i.test(message) ? 404 : 400 });
  }
}
