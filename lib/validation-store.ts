import { env } from "cloudflare:workers";
import { ProjectIdentity, ensureProject } from "./project-context-store";
import { RequestUser } from "./request-security";
import { ValidationStatus } from "./visual-validation";

function database() {
  if (!env.DB) throw new Error("Validation history is unavailable because the D1 binding is missing.");
  return env.DB;
}

export async function createValidationRun(input: { user: RequestUser; project: ProjectIdentity; commitSha: string; affectedRoutes: string[]; status: ValidationStatus }) {
  await ensureProject(input.user, input.project);
  const id = crypto.randomUUID(); const stamp = new Date().toISOString();
  await database().prepare(`INSERT INTO visual_validation_runs
    (id, project_id, owner_id, commit_sha, affected_routes_json, status, browser_results_json, artifact_keys_json, trusted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, input.project.id, input.user.userId, input.commitSha, JSON.stringify(input.affectedRoutes), input.status, "{}", "[]", stamp, stamp, stamp).run();
  return { id, projectId: input.project.id, commitSha: input.commitSha, affectedRoutes: input.affectedRoutes, status: input.status, createdAt: stamp };
}

export async function getValidationRun(user: RequestUser, projectId: string, validationId: string) {
  const row = await database().prepare("SELECT * FROM visual_validation_runs WHERE id = ? AND project_id = ? AND owner_id = ?").bind(validationId, projectId, user.userId).first<Record<string, string | number | null>>();
  if (!row) return null;
  const ppm = typeof row.pixel_diff_ppm === "number" ? row.pixel_diff_ppm : null;
  return {
    id: row.id, projectId: row.project_id, commitSha: row.commit_sha, status: row.status,
    affectedRoutes: JSON.parse(String(row.affected_routes_json)), browserResults: JSON.parse(String(row.browser_results_json)),
    pixelDiffRatio: ppm === null ? null : ppm / 1_000_000, artifactKeys: JSON.parse(String(row.artifact_keys_json)),
    baselineSha: row.baseline_sha, failureReason: row.failure_reason, durationMs: row.duration_ms,
    createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
