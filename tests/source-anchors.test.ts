import assert from 'node:assert/strict';
import test from 'node:test';
import { parse } from '@babel/parser';
import { sha256 } from '../lib/brand-documents';
import { instrumentJsxSource, inspectJsxAnchor, verifyJsxSourceAnchor } from '../lib/jsx-source-anchors';
import { decodeSourceAnchor, sourceAnchorSchema } from '../lib/source-anchor';
import { prepareBrowserTextPatch, applyBrowserSourcePatch } from '../lib/browser-source-patcher';

const source = `import React from 'react';
export default function Card(){return <main><h1>Same</h1><button {...props}>Same</button><input /><CardChild/><svg><foreignObject/></svg></main>}`;
async function mapped(text = source) {
  const hash = await sha256(text), result = instrumentJsxSource(text,'src/Card.tsx',hash);
  return { ...result, anchors: [...result.code.matchAll(/data-ah-source="([^"]+)"/g)].map(match => decodeSourceAnchor(match[1])!) };
}
test('compiler-only markers preserve clean source, line count and original JSX spans', async () => {
  const result = await mapped();
  parse(result.code,{sourceType:'module',plugins:['jsx','typescript']});
  assert.equal(result.count,6); assert.equal(result.code.split('\n').length,source.split('\n').length);
  assert.equal(source.includes('data-ah-source'),false);
  for (const anchor of result.anchors) { assert.equal(anchor.hash,await sha256(source)); assert.ok(inspectJsxAnchor(source,anchor).snippet.startsWith('<'+anchor.tag)); }
  assert.match(result.code,/<button \{\.\.\.props\} data-ah-source=/);
  assert.ok(result.anchors.some(anchor=>anchor.tag==='foreignObject'));
});
test('exact JSX source selection distinguishes duplicate visible copy and restores byte-exact inverse', async () => {
  const {anchors}=await mapped(); const button=anchors.find(anchor=>anchor.tag==='button')!;
  const {textTarget}=await verifyJsxSourceAnchor(source,button); assert.ok(textTarget);
  const patch=await prepareBrowserTextPatch(source,'Same','Start\n  now',button.hash,textTarget);
  assert.ok(patch.output.includes('<h1>Same</h1>')); assert.ok(patch.output.includes('Start'));
  assert.equal(await applyBrowserSourcePatch(patch.output,patch.inversePatch),source);
});
test('stale file, fabricated positions and different element types reject instead of guessing', async () => {
  const anchor=(await mapped()).anchors.find(anchor=>anchor.tag==='button')!;
  await assert.rejects(verifyJsxSourceAnchor(source+' ',anchor),/older source/);
  for (const altered of [{...anchor,start:anchor.start+1},{...anchor,tag:'h1'},{...anchor,line:999}]) await assert.rejects(verifyJsxSourceAnchor(source,altered),/no longer resolves/);
});
test('dynamic or mixed copy remains read-only; static string expressions support explicit whitespace', async () => {
  for(const children of ['Hello <em>world</em>','{name}','{t("hello")}']){
    const text=`export default()=> <p>${children}</p>`, anchor=(await mapped(text)).anchors[0];
    assert.equal(inspectJsxAnchor(text,anchor).textTarget,null);
  }
  const text='export default()=> <p>{"Hello\\n  world"}</p>', anchor=(await mapped(text)).anchors[0];
  assert.equal(inspectJsxAnchor(text,anchor).textTarget?.value,'Hello\n  world');
});
test('untrusted markers reject unsafe paths, invalid hashes and oversized encodings', async () => {
  const anchor=(await mapped()).anchors[0];
  for(const file of ['../secret.tsx','/secret.tsx','.git/x.tsx','.design-harness-runtime/x.tsx','node_modules/x.tsx','app.js']) assert.equal(sourceAnchorSchema.safeParse({...anchor,file}).success,false);
  for(const raw of [null,{},'%ZZ','x'.repeat(8193),encodeURIComponent(JSON.stringify({...anchor,hash:'wrong'}))]) assert.equal(decodeSourceAnchor(raw),null);
});
test('reserved attributes and excessive instrumentation refuse mapping without truncating source', async () => {
  assert.throws(()=>instrumentJsxSource('export default()=> <h1 data-ah-source="user"/>','x.tsx','a'.repeat(64)),/reserved/);
  assert.throws(()=>instrumentJsxSource('export default()=> <>'+Array.from({length:3001},()=>'<b/>').join('')+'</>','x.tsx','a'.repeat(64)),/element limit/);
});
