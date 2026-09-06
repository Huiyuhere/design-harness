import { parse } from "@babel/parser";
import postcss from "postcss";
import { sha256 } from "./edit-transaction";

export class SourceConflictError extends Error {
  constructor(message = "The source changed after this edit was planned.") {
    super(message);
    this.name = "SourceConflictError";
  }
}

const MAX_SOURCE_UNITS = 1_048_576;
type SyntaxNode = { type: string; start?: number | null; end?: number | null; [key: string]: unknown };
export type SourceRange = { start: number; end: number };
/** Offsets are JavaScript UTF-16 string offsets, as in Babel; hashes cover UTF-8 source. */
export type SourcePatch = { start: number; before: string; after: string; expectedHash: string; resultHash: string };

function bounded(source: string) {
  if (typeof source !== 'string' || source.length > MAX_SOURCE_UNITS) throw new Error('Source exceeds the direct-edit size limit.');
}
function requireHash(source: string, expectedHash: string) {
  bounded(source);
  if (sha256(source) !== expectedHash) throw new SourceConflictError();
}
function syntax(source: string) {
  bounded(source);
  return parse(source, { sourceType: 'module', plugins: ['jsx', 'typescript'] });
}
function isNode(value: unknown): value is SyntaxNode {
  return Boolean(value && typeof value === 'object' && typeof (value as SyntaxNode).type === 'string');
}
function* nodes(root: unknown): Generator<{ node: SyntaxNode; parent?: SyntaxNode }> {
  const stack: Array<{ value: unknown; parent?: SyntaxNode }> = [{ value: root }];
  while (stack.length) {
    const { value, parent } = stack.pop()!;
    if (Array.isArray(value)) { for (const child of value) stack.push({ value: child, parent }); }
    else if (isNode(value)) {
      yield { node: value, parent };
      for (const child of Object.values(value)) {
        if (Array.isArray(child) || isNode(child)) stack.push({ value: child, parent: value });
      }
    }
  }
}
function range(node: SyntaxNode): SourceRange {
  if (!Number.isInteger(node.start) || !Number.isInteger(node.end)) throw new Error('Source anchor has no exact range.');
  return { start: node.start!, end: node.end! };
}
function atAnchor(candidate: SourceRange, anchor?: SourceRange) {
  return !anchor || candidate.start === anchor.start && candidate.end === anchor.end;
}
function one<T>(matches: T[], kind: string): T {
  if (matches.length !== 1) throw new Error(matches.length ? `Ambiguous ${kind} requires an exact source anchor.` : `The selected ${kind} was not found at its source anchor.`);
  return matches[0];
}
function escapeJsx(value: string, quote?: string) {
  const escaped = value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;').replace(/\}/g, '&#125;');
  return quote === '"' ? escaped.replace(/"/g, '&quot;') : quote === "'" ? escaped.replace(/'/g, '&#39;') : escaped;
}
function decodeAttributeToken(raw: string, quote: string): string {
  if (!raw.includes('&')) return raw;
  for (const { node } of nodes(syntax(`<i className=${quote}${raw}${quote}/>`))) {
    if (node.type === 'JSXAttribute') return String((node.value as SyntaxNode).value);
  }
  throw new Error('Unable to resolve the literal class token.');
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

/** Exact static JSX child text only. Dynamic expressions and mixed-markup selections require approval. */
export function replaceJsxText(source: string, before: string, after: string, expectedHash = sha256(source), anchor?: SourceRange) {
  requireHash(source, expectedHash); bounded(before); bounded(after);
  const matches: Array<SourceRange & { expression: boolean }> = [];
  for (const { node, parent } of nodes(syntax(source))) {
    if (!parent || !['JSXElement', 'JSXFragment'].includes(parent.type)) continue;
    const opening = parent.openingElement as SyntaxNode | undefined;
    const name = opening?.name as SyntaxNode | undefined;
    if (name?.type === 'JSXIdentifier' && ['script', 'style'].includes(String(name.name))) continue;
    if (node.type === 'JSXText' && node.value === before && atAnchor(range(node), anchor)) matches.push({ ...range(node), expression: false });
    const expression = node.expression as SyntaxNode | undefined;
    if (node.type === 'JSXExpressionContainer' && expression?.type === 'StringLiteral' && expression.value === before && atAnchor(range(expression), anchor)) matches.push({ ...range(expression), expression: true });
  }
  const target = one(matches, 'JSX text');
  // Literal expressions preserve deliberate leading/trailing/repeated whitespace and
  // newlines, which a JSX compiler otherwise folds. They do not imply a CSS line break.
  const preserveWhitespace = !after || /^\s|\s$|[\r\n\t]| {2}/.test(after);
  const replacement = target.expression ? JSON.stringify(after) : preserveWhitespace ? `{${JSON.stringify(after)}}` : escapeJsx(after);
  const result = replaceSpan(source, target, replacement);
  syntax(result.output);
  return result;
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
  bounded(before); bounded(after);
  if (!before || !after || /[\t\n\f\r ]/.test(before + after)) throw new Error('Replace one complete class token at a time.');
  const matches: Array<SourceRange & { quote: string }> = [];
  for (const { node } of nodes(syntax(source))) {
    if (node.type !== 'JSXOpeningElement') continue;
    const attributes = node.attributes as SyntaxNode[];
    for (const [index, attribute] of attributes.entries()) {
      const name = attribute.name as SyntaxNode | undefined;
      const value = attribute.value as SyntaxNode | undefined;
      if (attribute.type !== 'JSXAttribute' || name?.type !== 'JSXIdentifier' || name.name !== 'className' || value?.type !== 'StringLiteral') continue;
      const location = range(value); const raw = source.slice(location.start + 1, location.end - 1);
      for (const token of raw.matchAll(/[^\t\n\f\r ]+/g)) {
        const target = { start: location.start + 1 + token.index!, end: location.start + 1 + token.index! + token[0].length };
        if (!atAnchor(target, anchor) || decodeAttributeToken(token[0], source[location.start]) !== before) continue;
        if (attributes.filter(attr => attr.type === 'JSXAttribute' && (attr.name as SyntaxNode)?.name === 'className').length !== 1) throw new Error('Duplicate class attributes require an assisted patch.');
        if (attributes.slice(index + 1).some(attr => attr.type === 'JSXSpreadAttribute')) throw new Error('A later prop spread can override this class; an assisted patch is required.');
        matches.push({ ...target, quote: source[location.start] });
      }
    }
  }
  const target = one(matches, 'Tailwind token');
  const result = replaceSpan(source, target, escapeJsx(after, target.quote));
  syntax(result.output);
  return result;
}
