import postcss from "postcss";
import { sha256 } from "./edit-transaction";
import { boundedSource as bounded, planJsxTextEdit, planTailwindEdit, type SourceRange } from './jsx-source-edits';
export type { SourceRange } from './jsx-source-edits';

export class SourceConflictError extends Error {
  constructor(message = "The source changed after this edit was planned.") {
    super(message);
    this.name = "SourceConflictError";
  }
}

/** Offsets are JavaScript UTF-16 string offsets; hashes cover UTF-8 source. */
export type SourcePatch = { start: number; before: string; after: string; expectedHash: string; resultHash: string };
function requireHash(source: string, expectedHash: string) {
  bounded(source);
  if (sha256(source) !== expectedHash) throw new SourceConflictError();
}
/** Fail closed on stale source, wrong offsets or a tampered forward/inverse payload. */
export function applySourcePatch(source: string, patch: SourcePatch): string {
  requireHash(source, patch.expectedHash);
  bounded(patch.before); bounded(patch.after);
  if (!Number.isSafeInteger(patch.start) || patch.start < 0 || patch.start + patch.before.length > source.length || source.slice(patch.start, patch.start + patch.before.length) !== patch.before) throw new SourceConflictError('The source span no longer matches this patch.');
  const output = source.slice(0, patch.start) + patch.after + source.slice(patch.start + patch.before.length);
  bounded(output);
  if (sha256(output) !== patch.resultHash) throw new SourceConflictError('The patch result hash does not match.');
  return output;
}
function replaceSpan(source: string, target: SourceRange, after: string) {
  const before = source.slice(target.start, target.end);
  const output = source.slice(0, target.start) + after + source.slice(target.end);
  bounded(output);
  const patch: SourcePatch = { start: target.start, before, after, expectedHash: sha256(source), resultHash: sha256(output) };
  const inversePatch: SourcePatch = { start: target.start, before: after, after: before, expectedHash: patch.resultHash, resultHash: patch.expectedHash };
  // Actually exercise the inverse. Never search for the replacement text elsewhere.
  return { output: applySourcePatch(source, patch), inverse: applySourcePatch(output, inversePatch), patch, inversePatch };
}


export function replaceJsxText(source: string, before: string, after: string, expectedHash = sha256(source), anchor?: SourceRange) {
  requireHash(source, expectedHash);
  const plan = planJsxTextEdit(source, before, after, anchor);
  return replaceSpan(source, { start: plan.start, end: plan.start + plan.before.length }, plan.after);
}

export async function setCssDeclaration(source: string, selector: string, property: string, value: string, expectedHash = sha256(source)) {
  requireHash(source, expectedHash);
  bounded(value);
  if (!/^(?:--[\w-]+|-?[a-zA-Z][\w-]*)$/.test(property)) throw new Error('A single CSS property is required.');
  // Parse the proposed value in isolation: it must remain exactly one declaration,
  // not append a selector, comment, at-rule, second property or an !important flag.
  const candidate = postcss.parse(`a{${property}:${value}}`);
  const candidateRule = candidate.nodes[0];
  if (candidate.nodes.length !== 1 || candidateRule?.type !== 'rule' || candidateRule.selector !== 'a' || candidateRule.nodes.length !== 1 || candidateRule.nodes[0].type !== 'decl' || candidateRule.nodes[0].prop !== property || candidateRule.nodes[0].important || candidateRule.nodes[0].value !== value) throw new Error('The CSS value must be one unambiguous declaration value.');
  const root = postcss.parse(source);
  let previous: string | undefined;
  let matches = 0;
  root.walkRules(selector, (rule) => {
    matches += 1;
    const declarations = rule.nodes.filter((node) => node.type === "decl" && node.prop === property);
    if (declarations.length > 1) throw new Error('Duplicate CSS declarations require an exact source anchor.');
    const declaration = declarations[0];
    if (declaration?.type === "decl") { previous = declaration.value; declaration.value = value; }
    else rule.append({ prop: property, value });
  });
  if (matches !== 1) throw new Error(matches ? "Ambiguous selector requires intent approval." : "CSS selector was not found.");
  const output = root.toString();
  // PostCSS retains untouched formatting. Keep the smallest exact changed span.
  let start = 0; let end = source.length; let outputEnd = output.length;
  while (start < end && start < outputEnd && source[start] === output[start]) start++;
  while (end > start && outputEnd > start && source[end - 1] === output[outputEnd - 1]) { end--; outputEnd--; }
  return { ...replaceSpan(source, { start, end }, output.slice(start, outputEnd)), previous: previous ?? null };
}


export function replaceTailwindToken(source: string, before: string, after: string, expectedHash = sha256(source), anchor?: SourceRange) {
  requireHash(source, expectedHash);
  const plan = planTailwindEdit(source, before, after, anchor);
  return replaceSpan(source, { start: plan.start, end: plan.start + plan.before.length }, plan.after);
}
