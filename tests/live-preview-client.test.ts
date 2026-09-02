import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";
import { repositoryArchiveToTree } from "../lib/live-preview-client";

test("converts a bounded GitHub zipball into one source tree and drops generated folders", () => {
  const archive = zipSync({
    "owner-repo-sha/package.json": strToU8('{"scripts":{"dev":"vite"}}'),
    "owner-repo-sha/index.html": strToU8("<html><head></head><body><div id=\"root\"></div></body></html>"),
    "owner-repo-sha/src/App.tsx": strToU8("export default function App(){return <h1>Hello</h1>}"),
    "owner-repo-sha/node_modules/nope.js": strToU8("ignored"),
  });
  const tree = repositoryArchiveToTree(archive);
  assert.ok(tree["package.json"]); assert.ok(tree.src); assert.equal(tree.node_modules, undefined);
  assert.ok(tree.public && "directory" in tree.public && tree.public.directory["__agent-harness-bridge.js"]);
  assert.match((tree["index.html"] as { file: { contents: string } }).file.contents, /__agent-harness-bridge\.js/);
});
