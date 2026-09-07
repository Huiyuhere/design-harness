import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import { createLocalCompanion } from '../../runtime/local-companion';

const root=await mkdtemp(join(tmpdir(),'design-harness-pair-browser-'));
const parent='https://design-harness.test',repositoryUrl='https://github.com/example/fixture',ref='a'.repeat(40),workspaceId='fixture';
const app=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'text/html'});res.end('<!doctype html><html><head><title>Actual fixture</title></head><body style="height:2000px"><h1>Actual local page</h1><button>Test button</button></body></html>');});
await new Promise<void>(r=>app.listen(4899,'127.0.0.1',r));
const companion=await createLocalCompanion({source:root,origin:parent,target:{repositoryUrl,ref,label:'fixture',changedFiles:0},controlPort:4897,previewPort:4898,start:async()=>4899,stop:async()=>{}});
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const report={scope:'Real localhost HTTP servers and Chromium; synthetic HTTPS parent and page. Not hosted Finite or production parity.',browser:browser.version(),checks:[] as string[],errors:[] as string[],failure:''};
try{
  const context=await browser.newContext();
  await context.route(parent+'/**',route=>route.fulfill({headers:{'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'},contentType:'text/html',body:'<!doctype html><html><body><h1>Harness</h1></body></html>'}));
  const page=await context.newPage();page.on('pageerror',e=>report.errors.push(e.message));
  await page.goto(parent);
  // Explicit test-origin permission, never disable the browser security feature.
  const cdp=await context.newCDPSession(page);const {targetInfo}=await cdp.send('Target.getTargetInfo');
  await cdp.send('Browser.setPermission',{permission:{name:'loopback-network'},setting:'granted',origin:parent,browserContextId:targetInfo.browserContextId});
  const result=await page.evaluate(async({code,repositoryUrl,ref,workspaceId})=>{
    const response=await fetch('http://localhost:4897/pair',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,repositoryUrl,ref,workspaceId,trusted:true})});
    const pair=await response.json() as {access:string;previewOrigin:string};if(!response.ok)return {status:response.status};
    await fetch('http://localhost:4897/start',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json',Authorization:'Bearer '+pair.access},body:JSON.stringify({workspaceId})});
    const iframe=document.createElement('iframe');iframe.src=pair.previewOrigin+'/?__ah_frame=test';iframe.allow='cross-origin-isolated; loopback-network';iframe.width='600';iframe.height='400';
    addEventListener('message',event=>{if(event.source!==iframe.contentWindow||event.origin!==pair.previewOrigin)return;if(event.data.type==='agent-harness:hello')iframe.contentWindow!.postMessage({type:'agent-harness:init',frameId:'test',mode:'edit',scroll:{windowY:200}},pair.previewOrigin);if(event.data.type==='agent-harness:ready')(window as unknown as {previewReady:boolean}).previewReady=true;});document.body.appendChild(iframe);
    return {status:response.status};
  },{code:companion.code,repositoryUrl,ref,workspaceId});
  assert.equal(result.status,200);
  await page.waitForFunction(()=>(window as unknown as {previewReady:boolean}).previewReady,{},{timeout:10000});
  const frame=page.frameLocator('iframe');assert.equal(await frame.locator('h1').innerText(),'Actual local page');
  assert.equal(await frame.locator('body').evaluate(()=>document.compatMode),'CSS1Compat');
  assert.equal(await frame.locator('body').evaluate(()=>scrollY),200);
  assert.equal(await frame.locator('body').evaluate(()=>document.cookie.includes('__Host-design-harness')),false);
  report.checks.push('HTTPS parent pairs over credentialed CORS with loopback','Partitioned HttpOnly cookie authorizes actual iframe and its bridge subresource','DOCTYPE preserved, real bridge ready, window scrolling restored','Preview script cannot read its authorization cookie');
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{await browser.close();await companion.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await rm(root,{recursive:true});await writeFile('outputs/audit/local-companion-browser.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));}
