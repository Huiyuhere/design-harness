import assert from 'node:assert/strict';
import test from 'node:test';
import {instrumentJsxSource,verifyJsxSourceAnchor} from '../lib/jsx-source-anchors';
import {decodeSourceAnchor} from '../lib/source-anchor';
import {sha256} from '../lib/brand-documents';
import {prepareBrowserRadiusPatch,applyBrowserSourcePatch} from '../lib/browser-source-patcher';
async function mapped(attrs=''){
  const source=`export default()=> <section><button>Duplicate</button><button id="target" ${attrs}>Duplicate</button></section>`;
  const hash=await sha256(source),code=instrumentJsxSource(source,'Card.tsx',hash).code;
  const anchors=[...code.matchAll(/data-ah-source="([^"]+)"/g)].map(match=>decodeSourceAnchor(match[1])!);
  return {source,anchor:anchors.filter(a=>a.tag==='button')[1]};
}
test('explicit radius override edits exact JSX element, not duplicate labels, and restores exact source',async()=>{
  for(const attrs of ['',`style={{ color:'red' }}`,`style={{ /* preserve */ }}`,`style={{borderRadius: 0, color:'red'}}`,`style={{'borderRadius': '0px'}}`]){
    const {source,anchor}=await mapped(attrs),patch=await prepareBrowserRadiusPatch(source,anchor,24);
    assert.ok(patch.output.includes('<button>Duplicate</button>'));
    assert.match(patch.output,/borderRadius['"]?:\s*24/);
    const next={...anchor,hash:patch.patch.resultHash,end:anchor.end+patch.output.length-source.length};await verifyJsxSourceAnchor(patch.output,next);
    assert.equal(await applyBrowserSourcePatch(patch.output,patch.inversePatch),source);
  }
});
test('ambiguous or dynamic inline styles are rejected instead of flattened',async()=>{
  for(const attrs of ['{...props}','style={theme}','style={{...theme}}','style={{[key]: 0}}','style={{borderRadius}}','style={{borderRadius: size}}','style={{borderRadius:0,borderRadius:2}}','style={{borderTopLeftRadius:2}}','style={{borderStartStartRadius:2}}','style={{get borderRadius(){return 2}}}','style={{}} style={{}}']){
    const {source,anchor}=await mapped(attrs);await assert.rejects(prepareBrowserRadiusPatch(source,anchor,24));
  }
});
test('radius bounds, fabricated anchor and stale hashes fail without a patch',async()=>{
  const {source,anchor}=await mapped();
  for(const value of [-1,513,NaN,Infinity])await assert.rejects(prepareBrowserRadiusPatch(source,anchor,value));
  await assert.rejects(prepareBrowserRadiusPatch(source+' ',anchor,24),/Source changed/);
  await assert.rejects(prepareBrowserRadiusPatch(source,{...anchor,start:anchor.start+1},24),/no longer resolves/);
  const patch=await prepareBrowserRadiusPatch(source,anchor,24);await assert.rejects(applyBrowserSourcePatch(patch.output+' ',patch.inversePatch),/Source changed/);
});
