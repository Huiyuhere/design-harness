export const MAX_PARALLEL_AGENT_JOBS = 5;

export type AgentJobStatus = "queued" | "thinking" | "ready" | "applying" | "applied" | "error" | "cancelled";
export type AgentPatch = { operation: "replace_text"; after: string; rationale: string };

export type AgentDesignJob = {
  id: string;
  workspaceId: string;
  frameId: string;
  sourceRouteId: string;
  scopeKey: string;
  frameName: string;
  route: string;
  node: string;
  nodeLabel: string;
  sourceFile?: string;
  before: string;
  prompt: string;
  intent: "discuss" | "edit";
  status: AgentJobStatus;
  reply: string;
  patch?: AgentPatch;
  receipt?: unknown;
  error?: string;
  createdAt: string;
  finishedAt?: string;
  durationMs?: number;
};

const ACTIVE = new Set<AgentJobStatus>(["queued", "thinking", "applying"]);

export function activeAgentJobs(jobs: AgentDesignJob[]) {
  return jobs.filter((job) => ACTIVE.has(job.status));
}

export function mayStartAgentJob(jobs: AgentDesignJob[], scopeKey: string, maxParallel = MAX_PARALLEL_AGENT_JOBS) {
  const active = activeAgentJobs(jobs);
  if (active.length >= maxParallel) return { allowed: false, reason: `All ${maxParallel} agent slots are busy.` };
  const conflict = active.find((job) => job.scopeKey === scopeKey);
  if (conflict) return { allowed: false, reason: `${conflict.frameName} already has an active edit. Wait or stop it before changing the same source scope.`, conflictId: conflict.id };
  return { allowed: true };
}

export function parseAgentPatch(output: string): AgentPatch | undefined {
  const match = output.match(/<design_patch>([\s\S]*?)<\/design_patch>/);
  if (!match) return undefined;
  try {
    const value = JSON.parse(match[1]) as Partial<AgentPatch>;
    if (value.operation !== "replace_text" || typeof value.after !== "string" || !value.after.trim() || value.after.length > 4_000) return undefined;
    return { operation: value.operation, after: value.after, rationale: typeof value.rationale === "string" ? value.rationale.slice(0, 2_000) : "Proposed copy update" };
  } catch { return undefined; }
}

export function visibleAgentReply(output: string) {
  return output.replace(/\s*<design_patch>[\s\S]*?<\/design_patch>\s*$/, "").trim();
}
