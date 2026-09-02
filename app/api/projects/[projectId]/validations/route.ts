import { NextRequest } from "next/server";
import { createValidationRun } from "../../../../../lib/validation-store";
import { initialValidationStatus, visualValidationRequestSchema } from "../../../../../lib/visual-validation";
import { jsonError, requestUser, sameOrigin, withinRateLimit } from "../../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = requestUser(request); if (!user) return jsonError("Sign in to register a visual validation.", 401);
    if (!sameOrigin(request)) return jsonError("Invalid request origin.", 403);
    if (!withinRateLimit(`validation:${user.userId}`, 6, 60_000)) return jsonError("Too many validation requests. Try again shortly.", 429);
    const { projectId } = await context.params;
    const input = visualValidationRequestSchema.parse(await request.json());
    if (input.project.id !== projectId) return jsonError("Project identifier mismatch.", 400);
    const run = await createValidationRun({ user, project: input.project, commitSha: input.commitSha, affectedRoutes: input.affectedRoutes, status: initialValidationStatus(input.workflowInstalled) });
    return Response.json({ ...run, disclosureRequired: true, productionVerified: false });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to register the visual validation.", 400);
  }
}
