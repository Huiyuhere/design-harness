import assert from "node:assert/strict";
import test from "node:test";
import { mayStartAgentJob, parseAgentPatch, visibleAgentReply, type AgentDesignJob } from "../lib/agent-jobs";

const job = (id: string, scopeKey: string, status: AgentDesignJob["status"] = "thinking"): AgentDesignJob => ({ id, scopeKey, status, workspaceId: "w", frameId: id, sourceRouteId: id, frameName: id, route: `/${id}`, node: "headline", nodeLabel: "Headline", before: "Before", prompt: "Edit it", intent: "edit", reply: "", createdAt: new Date().toISOString() });

test("permits five different source scopes but blocks a sixth", () => {
  const jobs = Array.from({ length: 5 }, (_, index) => job(String(index), `scope-${index}`));
  assert.equal(mayStartAgentJob(jobs, "scope-5").allowed, false);
  assert.equal(mayStartAgentJob(jobs.slice(0, 4), "scope-4").allowed, true);
});

test("gates concurrent edits that share a source scope", () => {
  const result = mayStartAgentJob([job("desktop", "app/page.tsx")], "app/page.tsx");
  assert.equal(result.allowed, false);
  assert.equal(result.conflictId, "desktop");
});

test("extracts a bounded text patch without showing its control payload", () => {
  const output = 'Short rationale.\n<design_patch>{"operation":"replace_text","after":"A clearer headline","rationale":"More specific"}</design_patch>';
  assert.deepEqual(parseAgentPatch(output), { operation: "replace_text", after: "A clearer headline", rationale: "More specific" });
  assert.equal(visibleAgentReply(output), "Short rationale.");
});
