export type BrandTokens = {
  colors: string[];
  fonts: string[];
  sourceFiles: string[];
  documents?: Array<{ path: string; kind: "brand" | "design"; content: string; sourceHash: string }>;
};

export function parseGitHubRepositoryUrl(value: string) {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.port || url.username || url.password || url.search || url.hash) throw new Error("Use a plain https://github.com/owner/repository URL without credentials or extra parameters.");
  const parts = url.pathname.replace(/^\/+|\/+$/g, "").split("/");
  const repository = parts[1]?.replace(/\.git$/, "");
  if (parts.length !== 2 || !/^[A-Za-z0-9][A-Za-z0-9-]{0,99}$/.test(parts[0]) || !repository || !/^[A-Za-z0-9._-]{1,100}$/.test(repository) || repository === "." || repository === "..") throw new Error("Use the repository root URL, not a branch, file, or settings page.");
  return { owner: parts[0], repository };
}

export function isBrandSource(path: string) {
  if (/(?:^|\/)(?:brand|design)\.md$/i.test(path)) return true;
  return /(?:brand|token|theme|variable|global|tailwind|design-system|style)/i.test(path) && /\.(?:css|scss|sass|less|ts|tsx|js|jsx|json|md)$/i.test(path);
}

export function extractBrandTokens(files: Array<{ path: string; content: string }>): BrandTokens {
  const colors: string[] = [];
  const fonts: string[] = [];
  const addUnique = (target: string[], value: string, limit: number) => {
    if (value && !target.some((item) => item.toLowerCase() === value.toLowerCase()) && target.length < limit) target.push(value);
  };
  for (const file of files) {
    for (const match of file.content.matchAll(/#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g)) addUnique(colors, match[0].toUpperCase(), 16);
    for (const match of file.content.matchAll(/font-family\s*:\s*([^;\n}]+)/gi)) {
      for (const candidate of match[1].split(",")) addUnique(fonts, candidate.trim().replace(/["']/g, ""), 8);
    }
    for (const match of file.content.matchAll(/(?:fontFamily|font-family)["']?\s*[:=]\s*["'`]([^"'`\n]+)/g)) addUnique(fonts, match[1].trim(), 8);
  }
  return {
    colors: colors.length ? colors : ["#202225", "#315EFB", "#FF6B47", "#F7F7F4"],
    fonts: fonts.filter((font) => !/^(sans-serif|serif|monospace|inherit|system-ui)$/i.test(font)).length
      ? fonts.filter((font) => !/^(sans-serif|serif|monospace|inherit|system-ui)$/i.test(font))
      : ["Inter", "Geist"],
    sourceFiles: files.map((file) => file.path),
  };
}
