import assert from 'node:assert/strict';
import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {buildPreviewBridge} from '../../lib/preview-bridge';

const parentOrigin='http://localhost:8790',childOrigin='http://127.0.0.1:8793';
const result={at:new Date().toISOString(),scope:'Actual cross-origin preview bridge with suspended animation callbacks. Synthetic readiness/scroll fixture, not Finite import or renderer RAM acceptance.',checks:[] as string[],errors:[] as string[],failure:undefined as string|undefined};
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const context=await browser.newContext();await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin===parentOrigin)return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body><script>window.readyMessage=false;addEventListener('message',e=>{if(e.origin!==${JSON.stringify(childOrigin)}||e.source!==document.querySelector('iframe')?.contentWindow)return;if(e.data.type==='agent-harness:hello')e.source.postMessage({type:'agent-harness:init',frameId:'paused',mode:'edit',scroll:{windowY:700}},e.origin);if(e.data.type==='agent-harness:ready')window.readyMessage=true;});</script><iframe title="Paused comparison" src="${childOrigin}/?__ah_frame=paused"></iframe></body></html>`});
    if(url.origin===childOrigin)return route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="height:2500px"><h1>Paused-frame fixture</h1><script>window.rafCalls=0;window.requestAnimationFrame=()=>{window.rafCalls++;return 1;};${buildPreviewBridge(parentOrigin)}</script></body></html>`});
    return route.abort();
  });
  const page=await context.newPage();page.on('pageerror',error=>result.errors.push(error.message));await page.goto(parentOrigin);
  await page.waitForFunction(()=>(window as unknown as {readyMessage:boolean}).readyMessage,{},{timeout:5000});
  const frame=page.frameLocator('iframe');assert.ok(await frame.locator('body').evaluate(()=>(window as unknown as {rafCalls:number}).rafCalls)>0);assert.equal(await frame.locator('body').evaluate(()=>scrollY),700);
  result.checks.push('A frame whose animation callbacks never execute still completes the real origin-checked handshake within five seconds and restores scroll to 700px');assert.deepEqual(result.errors,[]);
}catch(error){result.failure=String(error);process.exitCode=1;}
finally{await browser.close();await writeFile('outputs/audit/preview-readiness-results.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));}
