import assert from "node:assert/strict";
import test from "node:test";
import { sha256 } from "../lib/edit-transaction";
import { applySourcePatch, replaceJsxText, replaceTailwindToken, setCssDeclaration, SourceConflictError } from "../lib/source-patcher";
import { parse } from '@babel/parser';

test("replaces JSX text and produces an exact inverse", () => {
  const source = `export function Hero(){return <h1>Hello world</h1>}`;
  const result = replaceJsxText(source, "Hello world", "Design in code", sha256(source));
  assert.match(result.output, />Design in code</);
  assert.equal(result.inverse, source);
});

test("rejects stale source hashes", () => {
  assert.throws(() => replaceJsxText("const A=()=> <p>A</p>", "A", "B", "0".repeat(64)), SourceConflictError);
});

test("updates one CSS declaration without changing the selector", async () => {
  const source = `.hero { display: flex; gap: 24px; }`;
  const result = await setCssDeclaration(source, ".hero", "gap", "32px");
  assert.match(result.output, /gap: 32px/);
  assert.equal(result.previous, "24px");
});

test("replaces one Tailwind token and produces an inverse", () => {
  const source = `export const Card=()=> <div className="p-4 gap-4 text-sm">A</div>`;
  const result = replaceTailwindToken(source, "gap-4", "gap-8");
  assert.match(result.output, /gap-8/);
  assert.equal(result.inverse, source);
});

test('JSX edits ignore matching JavaScript strings, comments and non-child attributes', () => {
  for (const source of [
    'const sample=">Sale<"; export const Card=()=> <p>Body</p>',
    '/* >Sale< */ export const Card=()=> <p>Body</p>',
    'export const Card=()=> <p title="Sale">Body</p>',
    'export const Card=()=> <p title={"Sale"}>Body</p>',
    'export const Card=()=> <script>Sale</script>',
  ]) assert.throws(()=>replaceJsxText(source,'Sale','Changed'), /not found/);
  const source='/* >Sale< */ const sample=">Sale<"; export const Card=()=> <p>Sale</p>';
  const result=replaceJsxText(source,'Sale','New');
  assert.equal(result.output,source.replace('<p>Sale</p>','<p>New</p>'));
  assert.equal(result.inverse,source);
});

test('JSX inverse restores the selected span even when replacement text already exists', () => {
  const source='export const Card=()=> <><h1>New</h1><p>Old</p></>';
  const result=replaceJsxText(source,'Old','New');
  assert.equal(result.inverse,source);
  assert.equal(applySourcePatch(result.output,result.inversePatch),source);
  assert.equal(applySourcePatch(source,result.patch),result.output);
});

test('duplicate text requires an exact current source range', () => {
  const source='export const Card=()=> <><h1>Repeat</h1><p>Repeat</p></>';
  assert.throws(()=>replaceJsxText(source,'Repeat','New'),/Ambiguous/);
  const start=source.lastIndexOf('Repeat');
  const result=replaceJsxText(source,'Repeat','New',sha256(source),{start,end:start+6});
  assert.equal(result.output,source.replace('<p>Repeat</p>','<p>New</p>'));
  assert.throws(()=>replaceJsxText(source,'Repeat','New',sha256(source),{start:start+1,end:start+7}),/not found/);
});

test('punctuation and JSX-looking copy stay literal, never executable markup', () => {
  const source='export const Card=()=> <p>Before &amp; after</p>';
  const copy='<script>{window.bad = true}</script> & friends 😀';
  const result=replaceJsxText(source,'Before & after',copy);
  const ast=parse(result.output,{sourceType:'module',plugins:['jsx','typescript']});
  const text=JSON.stringify(ast);
  assert.ok(text.includes('JSXText'));
  assert.ok(!result.output.includes('<script>'));
  assert.ok(!result.output.includes('{window.bad'));
  assert.equal(result.inverse,source);
  assert.equal(replaceJsxText(result.output,copy,'Safe').output,'export const Card=()=> <p>Safe</p>');
});

test('intentional whitespace, newlines and empty copy survive future edits and exact undo', () => {
  const source='export const Card=()=> <p>Old</p>';
  for(const copy of ['  Two  spaces  ','Line one\nLine two','\tIndented','']) {
    const result=replaceJsxText(source,'Old',copy);
    assert.ok(result.output.includes('{'+JSON.stringify(copy)+'}'));
    assert.equal(result.inverse,source);
    assert.equal(replaceJsxText(result.output,copy,'New').output,'export const Card=()=> <p>{"New"}</p>');
  }
  const comments='export const Card=()=> <p>{/* keep this */ "Old"}</p>';
  assert.equal(replaceJsxText(comments,'Old','New').output,comments.replace('"Old"','"New"'));
});

test('dynamic or mixed-markup copy does not get flattened', () => {
  assert.throws(()=>replaceJsxText('export const Card=()=> <p>{title}</p>','title','New'),/not found/);
  assert.throws(()=>replaceJsxText('export const Card=()=> <p>Hello <em>friend</em></p>','Hello friend','New'),/not found/);
});

test('Tailwind inverse preserves whitespace, quote style, and earlier duplicate output tokens', () => {
  for(const source of [
    'export const Card=()=> <div className="p-4  gap-4\n text-sm">A</div>',
    "export const Card=()=> <div className='gap-8 gap-4'>A</div>",
    'export const Card=()=> <div className = "gap-4">A</div>',
  ]) {
    const result=replaceTailwindToken(source,'gap-4','gap-8');
    assert.equal(result.inverse,source);
    assert.equal(result.output,source.replace('gap-4','gap-8'));
  }
});

test('Tailwind edits cannot hit strings, comments, dynamic attributes or overridden classes', () => {
  for(const source of [
    'const sample=\'className="gap-4"\';export const Card=()=> <div/>',
    '/* className="gap-4" */ export const Card=()=> <div/>',
    'export const Card=()=> <div className={tokens}/>',
    'export const Card=()=> <div className="gap-4" {...props}/>',
    'export const Card=()=> <div className="gap-4" className="gap-8"/>',
  ]) assert.throws(()=>replaceTailwindToken(source,'gap-4','gap-8'));
  assert.throws(()=>replaceTailwindToken('export const A=()=> <div className="gap-4"/>','gap-4','gap-8 p-4'),/one complete class/);
});

test('duplicate Tailwind inputs need an anchor; entity-escaped output remains editable', () => {
  const source='export const Card=()=> <div className="gap-4 gap-4"/>';
  assert.throws(()=>replaceTailwindToken(source,'gap-4','gap-8'),/Ambiguous/);
  const start=source.lastIndexOf('gap-4');
  const result=replaceTailwindToken(source,'gap-4','gap-8',sha256(source),{start,end:start+5});
  assert.equal(result.output,'export const Card=()=> <div className="gap-4 gap-8"/>');
  const first=replaceTailwindToken('export const Card=()=> <div className="gap-4"/>','gap-4','before:content-["&"]');
  const second=replaceTailwindToken(first.output,'before:content-["&"]','gap-8');
  assert.equal(second.output,'export const Card=()=> <div className="gap-8"/>');
  assert.equal(applySourcePatch(second.output,second.inversePatch),first.output);
});

test('patch hashes and offsets refuse replay against modified source or forged payloads', () => {
  const source='// 😀 Unicode before target\nexport const Card=()=> <p>Old</p>';
  const result=replaceJsxText(source,'Old','New');
  assert.equal(result.inverse,source);
  assert.throws(()=>applySourcePatch(result.output+' ',result.inversePatch),SourceConflictError);
  assert.throws(()=>applySourcePatch(source,{...result.patch,start:-1}),SourceConflictError);
  assert.throws(()=>applySourcePatch(source,{...result.patch,after:'Forged'}),SourceConflictError);
  assert.throws(()=>applySourcePatch(source,{...result.patch,resultHash:'0'.repeat(64)}),SourceConflictError);
});

test('CSS insert/update retains comments, formatting and exact inverse, including important priority', async () => {
  for(const source of ['.a { /* keep */ gap: 24px !important; color:red; }','.a{color:red}']) {
    const result=await setCssDeclaration(source,'.a','gap','32px');
    assert.equal(result.inverse,source);
    assert.equal(applySourcePatch(result.output,result.inversePatch),source);
    assert.ok(result.output.includes('32px'));
    if(source.includes('!important'))assert.ok(result.output.includes('!important'));
  }
});

test('CSS ambiguity, declaration injection and implicit priority changes are rejected', async () => {
  for(const source of ['.a{gap:2px;gap:3px}', '.a{gap:2px}@media(max-width:600px){.a{gap:3px}}'])
    await assert.rejects(setCssDeclaration(source,'.a','gap','4px'));
  for(const value of ['red;color:blue','red}b{color:blue','red!important','/* comment */red'])
    await assert.rejects(setCssDeclaration('.a{color:red}','.a','color',value));
  await assert.rejects(setCssDeclaration('.a{color:red}','.a','color;bad','red'));
});

test('oversized direct edits fail with a bounded error', () => {
  assert.throws(()=>replaceJsxText('x'.repeat(1_048_577),'Old','New'),/size limit/);
  assert.throws(()=>replaceJsxText('export const A=()=> <p>Old</p>','Old','x'.repeat(1_048_577)),/size limit/);
});
