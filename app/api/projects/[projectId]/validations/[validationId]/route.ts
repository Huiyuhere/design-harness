import { NextRequest } from "next/server";
import { getValidationRun } from "../../../../../../lib/validation-store";
import { jsonError, requestUser } from "../../../../../../lib/request-security";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ projectId: string; validationId: string }> }) {
  try {
    const user = requestUser(request); if (!user) return jsonError("Sign in to view validation history.", 401);
    const { projectId, validationId } = await context.params;
    const run = await getValidationRun(user, projectId, validationId);
    if (!run) return jsonError("Validation run not found.", 404);
    return Response.json(run, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Unable to read the visual validation.", 400);
  }
}
