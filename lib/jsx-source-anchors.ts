import { parse } from '@babel/parser';
import { boundedSource } from './jsx-source-edits';
import { SOURCE_ATTRIBUTE, sourceAnchorSchema, type SourceAnchor } from './source-anchor';
import { sha256 } from './brand-documents';

type Node = { type: string; start: number; end: number; loc?: { start: { line: number; column: number } }; [key: string]: unknown };
function* walk(value: unknown): Generator<Node> {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { for (const child of value) yield* walk(child); return; }
  const node = value as Node;
  if (typeof node.type !== 'string') return;
  yield node;
  for (const [key, child] of Object.entries(node)) if (!['loc', 'extra', 'comments', 'leadingComments', 'trailingComments', 'innerComments', 'tokens'].includes(key)) yield* walk(child);
}
const syntax = (source: string) => { boundedSource(source); return parse(source, { sourceType: 'module', plugins: ['typescript', 'jsx'] }); };
const elements = (source: string) => [...walk(syntax(source))].filter(node => node.type === 'JSXElement');
const name = (opening: Node) => { const value = opening.name as Node; return value.type === 'JSXIdentifier' && /^[a-z]/.test(String(value.name)) ? String(value.name) : null; };

// Match JSX compilation whitespace, not CSS layout or raw source indentation.
function renderedJsxText(value:string) {
  const lines=value.split(/\r\n|\n|\r/);
  return lines.map((line,index)=>{
    let text=line.replace(/\t/g,' ');
    if(index>0)text=text.replace(/^ +/,'');
    if(index<lines.length-1)text=text.replace(/ +$/,'');
    return text;
  }).filter(Boolean).join(' ');
}

/** Insert attributes into compiler output only. The authoritative file is untouched. */
export function instrumentJsxSource(source: string, file: string, hash: string) {
  const edits: Array<{ at: number; text: string }> = [];
  for (const node of elements(source)) {
    const opening = node.openingElement as Node, tag = name(opening);
    if (!tag || ['script','style'].includes(tag)) continue;
    if (edits.length >= 3000) throw new Error('Source mapping exceeds the per-file element limit.');
    const attributes = opening.attributes as Node[];
    if (attributes.some(attribute => (attribute.name as Node)?.name === SOURCE_ATTRIBUTE)) throw new Error('Repository uses reserved data-ah-source attributes; mapping is unavailable.');
    const anchor = sourceAnchorSchema.parse({ v:1, file, hash, start:node.start, end:node.end, tag, line:node.loc?.start.line, column:node.loc?.start.column });
    // Appended after user props so a spread cannot silently override the marker.
    edits.push({ at:opening.end - (opening.selfClosing ? 2 : 1), text:` ${SOURCE_ATTRIBUTE}="${encodeURIComponent(JSON.stringify(anchor))}"` });
  }
  let code = source;
  for (const edit of edits.sort((a,b) => b.at-a.at)) code = code.slice(0,edit.at) + edit.text + code.slice(edit.at);
  return { code, count:edits.length };
}

/** Caller checks the full file hash first; exact AST location, not a text search. */
export function inspectJsxAnchor(source: string, untrusted: SourceAnchor) {
  const anchor = sourceAnchorSchema.parse(untrusted);
  const node = elements(source).find(item => item.start === anchor.start && item.end === anchor.end);
  if (!node || name(node.openingElement as Node) !== anchor.tag || node.loc?.start.line !== anchor.line || node.loc.start.column !== anchor.column) throw new Error('The JSX source anchor no longer resolves.');
  const children = (node.children as Node[]).filter(child => !(child.type === 'JSXExpressionContainer' && (child.expression as Node)?.type === 'JSXEmptyExpression'));
  const child = children.length === 1 ? children[0] : undefined;
  const literal = child?.type === 'JSXText' ? child : child?.type === 'JSXExpressionContainer' && (child.expression as Node)?.type === 'StringLiteral' ? child.expression as Node : undefined;
  const textTarget = literal ? { start:literal.start, end:literal.end, value:String(literal.value), renderedValue:literal.type==='JSXText'?renderedJsxText(String(literal.value)):String(literal.value) } : null;
  return { anchor, textTarget, snippet:source.slice(anchor.start,Math.min(anchor.end,anchor.start+4000)), truncated:anchor.end-anchor.start>4000 };
}

export async function verifyJsxSourceAnchor(source: string, anchor: SourceAnchor) {
  boundedSource(source);
  if (await sha256(source) !== anchor.hash) throw new Error('The selected element is from an older source version. Refresh the preview and select it again.');
  return inspectJsxAnchor(source, anchor);
}
