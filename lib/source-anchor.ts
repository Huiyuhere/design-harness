import { z } from 'zod';
import { safeRepositoryPath } from './archive-policy';

export const SOURCE_ATTRIBUTE = 'data-ah-source';
export const sourceAnchorSchema = z.object({
  v: z.literal(1), file: z.string().max(500).refine(path => { try { safeRepositoryPath(path); return /\.(?:jsx|tsx)$/.test(path) && !path.split('/').some(part => ['node_modules', '.git', '.design-harness-runtime'].includes(part)); } catch { return false; } }),
  hash: z.string().regex(/^[a-f0-9]{64}$/), start: z.number().int().min(0).max(1_048_576), end: z.number().int().positive().max(1_048_576),
  tag: z.string().regex(/^[a-z][a-zA-Z0-9-]{0,50}$/), line: z.number().int().positive(), column: z.number().int().min(0),
}).refine(value => value.end > value.start);
export type SourceAnchor = z.infer<typeof sourceAnchorSchema>;

export function decodeSourceAnchor(raw: unknown): SourceAnchor | null {
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  try { const json = decodeURIComponent(raw); if (json.length > 2048) return null; const parsed = sourceAnchorSchema.safeParse(JSON.parse(json)); return parsed.success ? parsed.data : null; } catch { return null; }
}
