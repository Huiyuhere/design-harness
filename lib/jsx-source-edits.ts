// Browser/server shared syntax planning. No Node APIs, hashing, or file access.
import { parse } from '@babel/parser';

type SyntaxNode = { type: string; start?: number | null; end?: number | null; [key: string]: unknown };
export type SourceRange = { start: number; end: number };
export function boundedSource(source: string) {
  if (typeof source !== 'string' || source.length > 1_048_576) throw new Error('Source exceeds the direct-edit size limit.');
}
const bounded = boundedSource;

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

/** Exact static JSX child text only. Dynamic expressions and mixed-markup selections require approval. */
export function planJsxTextEdit(source: string, before: string, after: string, anchor?: SourceRange) {
  bounded(source); bounded(before); bounded(after);
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
  const output = source.slice(0, target.start) + replacement + source.slice(target.end);
  bounded(output); syntax(output);
  return { output, start: target.start, before: source.slice(target.start, target.end), after: replacement };
}

export function planTailwindEdit(source: string, before: string, after: string, anchor?: SourceRange) {
  bounded(source);
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
  const replacement = escapeJsx(after, target.quote);
  const output = source.slice(0, target.start) + replacement + source.slice(target.end);
  bounded(output); syntax(output);
  return { output, start: target.start, before: source.slice(target.start, target.end), after: replacement };
}

/** Only literal anchors and recognized router imports; dynamic props stay untouched. */
export function planJsxLinkEdit(source: string, label: string, route: string) {
  bounded(source); bounded(label);
  if (!/^\/[a-z0-9/_-]{0,200}$/i.test(route) || route.startsWith('//') || route.includes('..')) throw new Error('A local static route is required.');
  const ast = syntax(source);
  const linkBindings = new Map<string, string>();
  for (const { node } of nodes(ast)) {
    if (node.type !== 'ImportDeclaration') continue;
    const moduleName = String((node.source as SyntaxNode)?.value);
    for (const specifier of node.specifiers as SyntaxNode[]) {
      const local = String((specifier.local as SyntaxNode)?.name);
      if (moduleName === 'next/link' && specifier.type === 'ImportDefaultSpecifier') linkBindings.set(local, 'href');
      if (['react-router', 'react-router-dom'].includes(moduleName) && specifier.type === 'ImportSpecifier' && ['Link', 'NavLink'].includes(String((specifier.imported as SyntaxNode)?.name))) linkBindings.set(local, 'to');
    }
  }
  const matches: Array<{ start: number; before: string; after: string }> = [];
  for (const { node } of nodes(ast)) {
    if (node.type !== 'JSXElement') continue;
    const opening = node.openingElement as SyntaxNode;
    const name = opening.name as SyntaxNode;
    if (name.type !== 'JSXIdentifier') continue;
    const property = name.name === 'a' ? 'href' : linkBindings.get(String(name.name));
    if (!property) continue;
    const children = (node.children as SyntaxNode[]).filter(child => !(child.type === 'JSXExpressionContainer' && (child.expression as SyntaxNode)?.type === 'JSXEmptyExpression'));
    if (children.length !== 1) continue;
    const child = children[0]; const expression = child.expression as SyntaxNode | undefined;
    const text = child.type === 'JSXText' ? child.value : child.type === 'JSXExpressionContainer' && expression?.type === 'StringLiteral' ? expression.value : undefined;
    if (text !== label) continue;
    const attributes = opening.attributes as SyntaxNode[];
    if (attributes.some(attribute => attribute.type === 'JSXSpreadAttribute')) throw new Error('Spread navigation props require an assisted patch.');
    const targets = attributes.filter(attribute => (attribute.name as SyntaxNode)?.name === property);
    if (targets.length > 1) throw new Error('Duplicate navigation props require an assisted patch.');
    const value = targets[0]?.value as SyntaxNode | undefined;
    if (targets.length && value?.type !== 'StringLiteral') throw new Error('Dynamic navigation requires an assisted patch.');
    if (value) {
      const location = range(value);
      matches.push({ start: location.start, before: source.slice(location.start, location.end), after: JSON.stringify(route) });
    } else {
      matches.push({ start: range(opening).end - 1, before: '', after: ` ${property}=${JSON.stringify(route)}` });
    }
  }
  const plan = one(matches, 'navigation control');
  const output = source.slice(0, plan.start) + plan.after + source.slice(plan.start + plan.before.length);
  bounded(output); syntax(output);
  return { ...plan, output };
}
