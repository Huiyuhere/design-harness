import assert from "node:assert/strict";
import test from "node:test";
import { extractBrandTokens, parseGitHubRepositoryUrl } from "../lib/brand-extractor";

test("parses and restricts GitHub repository URLs", () => {
  assert.deepEqual(parseGitHubRepositoryUrl("https://github.com/Huiyuhere/design-canvas"), { owner: "Huiyuhere", repository: "design-canvas" });
  assert.throws(() => parseGitHubRepositoryUrl("https://example.com/owner/repo"));
  assert.throws(() => parseGitHubRepositoryUrl("https://credential@github.com/owner/repo"));
  assert.throws(() => parseGitHubRepositoryUrl("https://github.com/owner/repo/tree/main"));
  assert.throws(() => parseGitHubRepositoryUrl("https://github.com/owner/repo?token=example"));
});

test("discovers brand colors and typography with provenance", () => {
  const brand = extractBrandTokens([
    { path: "styles/tokens.css", content: `:root{--ink:#112233;--accent:#F05A38;font-family: "Suisse Intl", sans-serif;}` },
    { path: "tailwind.config.ts", content: `fontFamily: 'IBM Plex Sans'` },
  ]);
  assert.deepEqual(brand.colors, ["#112233", "#F05A38"]);
  assert.deepEqual(brand.fonts, ["Suisse Intl", "IBM Plex Sans"]);
  assert.deepEqual(brand.sourceFiles, ["styles/tokens.css", "tailwind.config.ts"]);
});
