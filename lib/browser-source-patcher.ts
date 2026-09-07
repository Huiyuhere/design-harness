import { sha256 } from './brand-documents';
import { boundedSource, planJsxTextEdit, planJsxLinkEdit, type SourceRange } from './jsx-source-edits';
import type { SourcePatch } from './source-patcher';

/** Browser-safe exact replay. Never import Node's crypto implementation here. */
export async function applyBrowserSourcePatch(source: string, patch: SourcePatch) {
  boundedSource(source); boundedSource(patch.before); boundedSource(patch.after);
  if (await sha256(source) !== patch.expectedHash) throw new Error('Source changed after this proposal. Reload and generate a new edit.');
  if (!Number.isSafeInteger(patch.start) || patch.start < 0 || source.slice(patch.start, patch.start + patch.before.length) !== patch.before || patch.start + patch.before.length > source.length) throw new Error('Source span no longer matches the approved patch.');
  const output = source.slice(0, patch.start) + patch.after + source.slice(patch.start + patch.before.length);
  boundedSource(output);
  if (await sha256(output) !== patch.resultHash) throw new Error('Patch result does not match its expected hash.');
  return output;
}

/** The expected hash must come from request-time source, not approval-time source. */
export async function prepareBrowserTextPatch(source: string, before: string, after: string, expectedHash: string, anchor?: SourceRange) {
  return prepareBrowserPatch(source, expectedHash, () => planJsxTextEdit(source, before, after, anchor));
}

export async function prepareBrowserLinkPatch(source: string, label: string, route: string, expectedHash: string) {
  return prepareBrowserPatch(source, expectedHash, () => planJsxLinkEdit(source, label, route));
}

async function prepareBrowserPatch(source: string, expectedHash: string, planEdit: () => { output: string; start: number; before: string; after: string }) {
  boundedSource(source);
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || await sha256(source) !== expectedHash) throw new Error('Source changed after this proposal. Reload and generate a new edit.');
  const plan = planEdit();
  const resultHash = await sha256(plan.output);
  const patch: SourcePatch = { start: plan.start, before: plan.before, after: plan.after, expectedHash, resultHash };
  const inversePatch: SourcePatch = { start: plan.start, before: plan.after, after: plan.before, expectedHash: resultHash, resultHash: expectedHash };
  return { output: await applyBrowserSourcePatch(source, patch), inverse: await applyBrowserSourcePatch(plan.output, inversePatch), patch, inversePatch };
}
