import { z } from "zod";

export const VALIDATION_STATUSES = ["queued", "running", "passed", "failed", "cancelled", "actions_disabled", "allowance_blocked", "workflow_missing", "not_verified"] as const;
export type ValidationStatus = (typeof VALIDATION_STATUSES)[number];

export const visualValidationRequestSchema = z.object({
  project: z.object({ id: z.string().min(1), name: z.string().min(1), repository: z.string().min(1), baseSha: z.string().min(1) }),
  commitSha: z.string().regex(/^[a-f0-9]{7,64}$/i),
  affectedRoutes: z.array(z.string().startsWith("/")).min(1).max(90),
  trusted: z.literal(true),
  workflowInstalled: z.boolean(),
});

export const ACTIONS_LIMITATIONS = [
  "A pushed commit is required; uncommitted canvas edits cannot be verified.",
  "Jobs can queue and take several minutes to install, build, and capture.",
  "Private repositories use plan-dependent Actions minutes and may incur charges after the included allowance.",
  "The GitHub-hosted runner receives and executes repository source and dependency scripts.",
  "Linux headless Chromium is deterministic but is not macOS, an iPhone, or actual Safari.",
  "Private APIs, VPN services, production credentials, and databases require explicit fixtures.",
  "Actions can be unavailable because of policy, disabled workflows, runner capacity, or spending limits.",
  "Artifacts expire, so approved evidence must be ingested before retention ends.",
  "AI browser review is qualitative and never replaces deterministic screenshot thresholds.",
] as const;

export function initialValidationStatus(workflowInstalled: boolean): ValidationStatus {
  return workflowInstalled ? "queued" : "workflow_missing";
}

export function mayClaimPixelVerified(status: ValidationStatus, diffRatio: number | null) {
  return status === "passed" && diffRatio !== null && diffRatio <= 0.001;
}
