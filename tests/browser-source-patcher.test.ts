import assert from 'node:assert/strict';
import test from 'node:test';
import { sha256 } from '../lib/edit-transaction';
import { prepareBrowserTextPatch, prepareBrowserLinkPatch, applyBrowserSourcePatch } from '../lib/browser-source-patcher';
import { replaceJsxText } from '../lib/source-patcher';

test('browser text planner matches server patches and exact inverses', async () => {
  const source='// >Old< is only a comment\nexport const A=()=> <><h1>New</h1><p>Old</p></>';
  const copy='<b>{globalThis.executed=true}</b> & hello\n  world';
  const browser=await prepareBrowserTextPatch(source,'Old',copy,sha256(source));
  assert.deepEqual(browser,replaceJsxText(source,'Old',copy));
  assert.equal(await applyBrowserSourcePatch(browser.output,browser.inversePatch),source);
});

test('browser approvals require the request-time hash and reject forged inverse spans', async () => {
  const source='export const A=()=> <p>Old</p>';
  await assert.rejects(prepareBrowserTextPatch(source+' ','Old','New',sha256(source)),/Source changed/);
  await assert.rejects(prepareBrowserTextPatch(source,'Old','New',''),/Source changed/);
  const result=await prepareBrowserTextPatch(source,'Old','New',sha256(source));
  await assert.rejects(applyBrowserSourcePatch(result.output,{...result.inversePatch,start:-1}),/span/);
  await assert.rejects(applyBrowserSourcePatch(result.output,{...result.inversePatch,after:'Forged'}),/result/);
});

test('browser text edits reject JavaScript-only and duplicate matches', async () => {
  const source='const sample=">Old<"; export const A=()=> <p>Other</p>';
  await assert.rejects(prepareBrowserTextPatch(source,'Old','New',sha256(source)),/not found/);
  const duplicate='export const A=()=> <><p>Old</p><p>Old</p></>';
  await assert.rejects(prepareBrowserTextPatch(duplicate,'Old','New',sha256(duplicate)),/Ambiguous/);
  const start=duplicate.lastIndexOf('Old');
  const result=await prepareBrowserTextPatch(duplicate,'Old','New',sha256(duplicate),{start,end:start+3});
  assert.equal(result.output,'export const A=()=> <><p>Old</p><p>New</p></>');
});

test('static link edits match actual JSX, not a matching comment or string', async () => {
  const source='const sample=\'<a href="/old">Docs</a>\'; export const A=()=> <a href="/old">Docs</a>';
  const result=await prepareBrowserLinkPatch(source,'Docs','/docs',sha256(source));
  assert.equal(result.output,'const sample=\'<a href="/old">Docs</a>\'; export const A=()=> <a href="/docs">Docs</a>');
  assert.equal(result.inverse,source);
});

test('link adapters recognize imported aliases and preserve literal children', async () => {
  for (const [source,property] of [
    ['export const A=()=> <a>{"Docs"}</a>','href'],
    ['import Go from "next/link";export const A=()=> <Go href="/old">Docs</Go>','href'],
    ['import {NavLink as Go} from "react-router-dom";export const A=()=> <Go to="/old">Docs</Go>','to'],
  ]) {
    const result=await prepareBrowserLinkPatch(source,'Docs','/docs',sha256(source));
    assert.ok(result.output.includes(`${property}="/docs"`));
    assert.equal(result.inverse,source);
  }
});

test('ambiguous or dynamic navigation is not silently rewritten', async () => {
  for(const source of [
    'export const A=()=> <><a>Docs</a><a>Docs</a></>',
    'export const A=()=> <a href={target}>Docs</a>',
    'export const A=()=> <a {...props}>Docs</a>',
    'export const A=()=> <Link>Docs</Link>',
    'export const A=()=> <a href="/a" href="/b">Docs</a>',
    'export const A=()=> <a>Go <b>Docs</b></a>',
  ]) await assert.rejects(prepareBrowserLinkPatch(source,'Docs','/docs',sha256(source)));
  const source='export const A=()=> <a>Docs</a>';
  for(const route of ['https://example.com','//example.com','/../private','/docs" onClick="bad'])
    await assert.rejects(prepareBrowserLinkPatch(source,'Docs',route,sha256(source)),/local static route/);
});
