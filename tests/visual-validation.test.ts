import assert from "node:assert/strict";
import test from "node:test";
import { ACTIONS_LIMITATIONS, initialValidationStatus, mayClaimPixelVerified, visualValidationRequestSchema } from "../lib/visual-validation";

test("requires explicit trust and refuses to imply verification without passing pixel evidence", () => {
  assert.throws(() => visualValidationRequestSchema.parse({ project: { id: "p", name: "P", repository: "a/b", baseSha: "1234567" }, commitSha: "1234567", affectedRoutes: ["/"], trusted: false, workflowInstalled: true }));
  assert.equal(initialValidationStatus(false), "workflow_missing");
  assert.equal(mayClaimPixelVerified("passed", null), false);
  assert.equal(mayClaimPixelVerified("passed", 0.001), true);
  assert.equal(mayClaimPixelVerified("passed", 0.0011), false);
});

test("discloses push, cost, source execution, environment, and availability limitations", () => {
  const disclosure = ACTIONS_LIMITATIONS.join(" ");
  for (const required of ["pushed commit", "minutes", "executes repository source", "Linux headless Chromium", "unavailable"]) assert.match(disclosure, new RegExp(required, "i"));
});
