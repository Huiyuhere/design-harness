import { NextRequest } from "next/server";
import { z } from "zod";
import { apiKeyCookie, maskApiKey, sealApiKeySession } from "../../../../../lib/api-key-session";
import { encryptionSecret } from "../../../../../lib/openai-key";
import { jsonError, requestUser, sameOrigin, withinRateLimit } from "../../../../../lib/request-security";

export const dynamic = "force-dynamic";

const schema = z.object({ apiKey: z.string().trim().min(20).max(512) });
const REQUIRED_MODELS = ["gpt-5.4-mini", "gpt-5.4"] as const;

async function modelAccess(apiKey: string, model: string) {
  const response = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  return { model, status: response.status, ok: response.ok };
}

export async function POST(request: NextRequest) {
  const user = requestUser(request);
  if (!user) return jsonError("Sign in before connecting an API key.", 401);
  if (!sameOrigin(request)) return jsonError("Cross-origin requests are not allowed.", 403);
  if (!withinRateLimit(`openai-key:${user.userId}`, 6, 60_000)) return jsonError("Too many validation attempts. Try again in a minute.", 429);
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return jsonError("Enter a complete OpenAI API key.", 400);
  const secret = encryptionSecret();
  if (!secret) return jsonError("Secure key storage is not configured for this deployment.", 503);

  const checks = await Promise.all(REQUIRED_MODELS.map((model) => modelAccess(parsed.data.apiKey, model)));
  if (checks.some((check) => check.status === 401)) return jsonError("OpenAI rejected this key. Check that it is complete and still active.", 401);
  if (checks.every((check) => !check.ok)) return jsonError("The key is valid but does not have access to the required Design Harness models.", 422);
  const models = checks.filter((check) => check.ok).map((check) => check.model);
  const validatedAt = new Date().toISOString();
  const masked = maskApiKey(parsed.data.apiKey);
  const sealed = await sealApiKeySession({ apiKey: parsed.data.apiKey, models, validatedAt, masked }, user.userId, secret);
  return Response.json(
    { connected: true, masked, models, validatedAt },
    { headers: { "Set-Cookie": apiKeyCookie(sealed), "Cache-Control": "no-store" } },
  );
}
