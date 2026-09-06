import { chromium } from '@playwright/test';
import { writeFile, readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { buildPreviewBridge } from '../../lib/preview-bridge';
import { build } from 'vite';
import react from '@vitejs/plugin-react';

const origin='http://localhost:8790';
const result={scope:'Actual PreviewFrame component + actual generated preview bridge in cross-origin Chromium iframes. Synthetic page fixture, NOT private repository import/render acceptance.',checks:[] as string[],errors:[] as string[],failure:undefined as string|undefined};
await build({configFile:false,plugins:[react()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:'outputs/audit/preview-dist',emptyOutDir:true,lib:{entry:'tests/browser/preview-fixture.tsx',formats:['es'],fileName:()=> 'fixture.js'}}});
const fixtureJs=await readFile(new URL('../../outputs/audit/preview-dist/fixture.js',import.meta.url),'utf8');
const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
try {
  const context=await browser.newContext({viewport:{width:1440,height:1000}});
  let frameNavigations=0;
  await context.route('**/*',async route=>{
    const url=new URL(route.request().url());
    if(url.origin==='http://127.0.0.1:8793') {
      frameNavigations++;
      return route.fulfill({headers:{'content-type':'text/html','Cross-Origin-Resource-Policy':'cross-origin','Cross-Origin-Embedder-Policy':'credentialless'},body:`<!doctype html><html><head><style>body{margin:0;font:16px system-ui;min-height:3600px}#nested{width:200px;height:180px;overflow:auto;border:1px solid black;margin:20px}#nested div{height:1200px}h1{margin:0}</style></head><body><h1>Real scroll fixture</h1><div id="nested"><div>Nested content</div></div><p>Long page</p><script>${buildPreviewBridge(origin)}</script></body></html>`});
    }
    if(url.origin!==origin)return route.abort();
    if(url.pathname==='/__fixture.js')return route.fulfill({contentType:'text/javascript',body:fixtureJs});
    if(url.pathname==='/__preview_audit')return route.fulfill({headers:{'content-type':'text/html','Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'},body:'<!doctype html><html><body><div id="root"></div><script type="module" src="/__fixture.js"></script></body></html>'});
    return route.abort();
  });
  const page=await context.newPage();page.setDefaultTimeout(15000);page.on('pageerror',e=>{if(result.errors.length<10&&!result.errors.includes(e.message))result.errors.push(e.message);});
  await page.goto(origin+'/__preview_audit',{waitUntil:'networkidle',timeout:60000});
  await page.getByRole('heading',{name:'Actual iframe / bridge regression fixture'}).waitFor();
  console.log('Fixture mounted; checking iframe handshake');
  await page.waitForFunction(()=>JSON.parse(document.querySelector('#snapshots')!.textContent||'{}')['frame-0']);
  assert.equal(await page.locator('iframe').count(),1);
  const first=page.frameLocator('iframe[title="frame-0"]');
  await first.locator('body').evaluate(()=>{document.querySelector('#nested')!.scrollTop=420;window.scrollTo(0,900);});
  await page.waitForFunction(()=>{const s=JSON.parse(document.querySelector('#snapshots')!.textContent||'{}')['frame-0'];return s?.windowY===900&&s.containers.some((c:{y:number})=>c.y===420);});
  assert.equal(frameNavigations,1,'Saving scroll must not navigate the iframe');
  assert.equal(await first.locator('body').evaluate(()=>scrollY),900);
  result.checks.push('window + stable nested scroll saved without reloading iframe');
  await page.getByRole('button',{name:'Pin comparisons',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===3);
  await page.waitForFunction(()=>Object.keys(JSON.parse(document.querySelector('#snapshots')!.textContent||'{}')).length===3);
  await page.evaluate(()=>window.addEventListener('message',event=>{
    if(event.origin==='http://127.0.0.1:8793'&&event.data?.frameId==='frame-0'&&event.data?.snapshot?.windowY===9999)
      (window as Window & {auditSawForged?:boolean}).auditSawForged=true;
  }));
  await page.frameLocator('iframe[title="frame-1"]').locator('body').evaluate((_element,parentOrigin)=>parent.postMessage({type:'agent-harness:scroll',frameId:'frame-0',snapshot:{windowY:9999}},parentOrigin),origin);
  // Prove delivery before checking rejection, rather than passing on a message
  // the browser silently discarded because of an incorrect targetOrigin.
  await page.waitForFunction(()=>(window as Window & {auditSawForged?:boolean}).auditSawForged===true);
  assert.equal(await page.locator('#snapshots').evaluate(e=>JSON.parse(e.textContent!)['frame-0'].windowY),900);
  result.checks.push('same-origin sibling cannot forge another frame scroll record');
  await page.getByRole('button',{name:'Focus first',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===1&&document.querySelector('#focus iframe'));
  await page.frameLocator('#focus iframe').locator('body').evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
  await page.waitForFunction(()=>!document.querySelector('.frame-runtime-feedback'));
  assert.equal(await page.frameLocator('#focus iframe').locator('body').evaluate(()=>scrollY),900);
  assert.equal(await page.frameLocator('#focus iframe').locator('#nested').evaluate(e=>e.scrollTop),420);
  result.checks.push('focus uses one iframe, restores window and nested position');
  await page.getByRole('button',{name:'Close focus',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===3);
  await page.getByRole('button',{name:'Zoom out',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===0);
  await page.getByRole('button',{name:'Zoom in',exact:true}).click();
  await page.waitForFunction(()=>document.querySelectorAll('iframe').length===3&&!document.querySelector('.frame-runtime-feedback'));
  assert.equal(await page.frameLocator('iframe[title="frame-0"]').locator('body').evaluate(()=>scrollY),900);
  result.checks.push('90-frame schedule: three maximum, zero below 65%, position restored on return');
  await page.frameLocator('iframe[title="frame-0"]').locator('body').evaluate((_element,parentOrigin)=>{
    parent.postMessage({type:'agent-harness:runtime-error',frameId:'frame-0',message:'Synthetic runtime failure'},parentOrigin);
    parent.postMessage({type:'agent-harness:ready',frameId:'frame-0'},parentOrigin);
  },origin);
  await page.getByRole('alert').waitFor();
  await page.getByRole('alert').getByText('Details',{exact:true}).click();
  await page.getByText('Synthetic runtime failure',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Retry frame-0 preview',exact:true}).click();
  await page.waitForFunction(()=>!document.querySelector('.frame-runtime-feedback'));
  assert.equal(await page.frameLocator('iframe[title="frame-0"]').locator('body').evaluate(()=>scrollY),900);
  result.checks.push('runtime error survives late ready message; explicit retry reconnects and restores scroll');
  await page.getByRole('button',{name:'Save source draft',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#draft-status')?.textContent==='Saved');
  await page.reload({waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Read source draft',exact:true}).click();
  await page.waitForFunction(()=>document.querySelector('#draft-status')?.textContent==='approved edit');
  result.checks.push('actual IndexedDB source delta survives full page reload');
  await page.screenshot({path:new URL('../../outputs/audit/preview-scroll.png',import.meta.url).pathname});
  assert.equal(result.errors.length,0);
}catch(error){result.failure=(error as Error).message;process.exitCode=1;}
finally{await browser.close();await writeFile(new URL('../../outputs/audit/preview-scroll-results.json',import.meta.url),JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));}
