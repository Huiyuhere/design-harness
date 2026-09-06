export type DiscoveredRoute = { route: string; file: string; dynamic: boolean; framework: "next-app" | "next-pages" | "react-router" };

function normalizeNextSegment(segment: string) {
  if (/^\(.+\)$/.test(segment)) return "";
  if (/^(?:page|index)\.(?:t|j)sx?$/.test(segment)) return "";
  return segment.replace(/\.(?:t|j)sx?$/, "");
}

export function discoverFileRoutes(files: string[]): DiscoveredRoute[] {
  const routes: DiscoveredRoute[] = [];
  for (const file of files) {
    const relative = file.replace(/^src\//, '');
    if (/^app\/(?:.*\/)?page\.(?:t|j)sx?$/.test(relative)) {
      // Parallel and intercepting routes need explicit state fixtures, not
      // invented top-level URL paths.
      if (relative.split('/').some(part=>part.startsWith('@') || /^\(\.{1,3}\)/.test(part))) continue;
      const parts = relative.split("/").slice(1).map(normalizeNextSegment).filter(Boolean);
      routes.push({ route: `/${parts.join("/")}`, file, dynamic: parts.some((part) => part.includes("[")), framework: "next-app" });
    } else if (/^pages\/.+\.(?:t|j)sx?$/.test(relative) && !/^pages\/(?:_app\.|_document\.|_error\.|api\/)/.test(relative) && !relative.endsWith('.d.ts')) {
      const parts = relative.split("/").slice(1).map(normalizeNextSegment).filter(Boolean);
      routes.push({ route: `/${parts.join("/")}`, file, dynamic: parts.some((part) => part.includes("[")), framework: "next-pages" });
    }
  }
  return routes.sort((a, b) => a.route.localeCompare(b.route));
}

export function discoverSourceRoutes(files: Array<{ path: string; content: string }>): DiscoveredRoute[] {
  const routes = new Map<string, DiscoveredRoute>();
  for (const file of files) {
    const patterns = [
      /<Route\b[^>]*\bpath\s*=\s*(?:\{\s*)?["'`]([^"'`]+)["'`](?:\s*\})?/g,
      /\b(?:path|route)\s*:\s*["'`]([^"'`]+)["'`]/g,
    ];
    for (const pattern of patterns) {
      for (const match of file.content.matchAll(pattern)) {
        const route = match[1].trim();
        if (!route.startsWith("/") || route === "*") continue;
        routes.set(route, { route, file: file.path, dynamic: /[:*\[]/.test(route), framework: "react-router" });
      }
    }
  }
  return [...routes.values()].sort((a, b) => a.route.localeCompare(b.route));
}

export function extractLinkEdges(source: string, fromRoute: string) {
  const edges = new Set<string>();
  for (const match of source.matchAll(/(?:href|to)\s*=\s*["'](\/[A-Za-z0-9_\-\/[\]]*)["']/g)) edges.add(match[1]);
  return [...edges].map((toRoute) => ({ fromRoute, toRoute, kind: "declared" as const }));
}
