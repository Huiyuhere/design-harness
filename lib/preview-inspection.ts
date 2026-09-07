import { z } from 'zod';
import { decodeSourceAnchor } from './source-anchor';

export const INSPECTION_LIMIT = 200;
const nodeId = z.string().regex(/^n[1-9][0-9]{0,8}$/);
const text = z.string().max(2000);
const layer = z.object({ id: nodeId, parentId: nodeId.nullable(), tag: z.string().regex(/^[a-z][a-z0-9-]{0,50}$/), label: z.string().max(120), depth: z.number().int().min(0).max(24) });
const properties = z.object({
  display: text, position: text, width: text, height: text, color: text, backgroundColor: text,
  fontFamily: text, fontSize: text, fontWeight: text, lineHeight: text, borderRadius: text, gap: text, padding: text, margin: text,
});
export const inspectionSchema = z.object({
  generation: z.string().uuid(), capturedAt: z.string().datetime(), truncated: z.boolean(),
  layers: z.array(layer).max(INSPECTION_LIMIT),
  selection: layer.extend({ text, styles: properties, width: z.number().finite().min(0).max(1e7), height: z.number().finite().min(0).max(1e7), source: z.unknown().transform(decodeSourceAnchor) }).nullable(),
}).superRefine((value, ctx) => {
  const seen = new Set<string>();
  for (const node of value.layers) {
    if (seen.has(node.id) || node.parentId && !seen.has(node.parentId)) ctx.addIssue({ code: 'custom', message: 'Invalid DOM hierarchy.' });
    seen.add(node.id);
  }
});
export type PreviewInspection = z.infer<typeof inspectionSchema>;
export type InspectCommand = { sequence: number; nodeId?: string; generation?: string };
export type PreviewMode = 'edit' | 'prototype' | 'graph';

/** Runtime messages are untrusted, bounded data, never source-edit authority. */
export function readInspection(value: unknown): PreviewInspection | null {
  if (!value || typeof value !== 'object' || !('layers' in value) || !Array.isArray(value.layers) || value.layers.length > INSPECTION_LIMIT) return null;
  const parsed = inspectionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
