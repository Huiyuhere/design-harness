import { chromium, expect } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';

const report={startedAt:new Date().toISOString(),completedAt:null as string|null,scope:'Real WebContainer and PreviewFrame with synthetic source. Compares Playwright locator coordinates with measured screen-coordinate mouse input; not a signed-in Site or human usability test.',checks:[] as Array<Record<string,unknown>>,errors:[] as string[],failure:null as string|null};
await build({configFile:false,publicDir:false,plugins:[react()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:'outputs/audit/pointer-dist',emptyOutDir:true,lib:{entry:'tests/browser/source-anchor-fixture.tsx',formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}});
const directory=new URL('../../outputs/audit/pointer-dist/',import.meta.url);
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
const server=createServer(async(req,res)=>{try{
  if(req.url?.split('?')[0]==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');return;}
  const path=req.url==='/preview-tools/source-plugin.mjs'?new URL('../../public/preview-tools/source-plugin.mjs',import.meta.url):new URL(req.url!.slice(1),directory);
  if(!path.pathname.startsWith(directory.pathname)&&req.url!=='/preview-tools/source-plugin.mjs')throw Error('Not found');
  res.writeHead(200,{...headers,'Content-Type':req.url?.endsWith('.css')?'text/css':'text/javascript'});res.end(await readFile(path));
}catch{if(!res.headersSent)res.writeHead(404);res.end();}});
await new Promise<void>(resolve=>server.listen(8796,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
  const page=await browser.newPage({viewport:{width:1600,height:1000}});page.setDefaultTimeout(15000);page.on('pageerror',error=>report.errors.push(error.message));
  await page.goto('http://127.0.0.1:8796/?memory=1');await page.waitForFunction(()=>Boolean(window.anchorTest));
  await page.getByRole('button',{name:'Start browser runtime',exact:true}).click();
  const iframe=page.locator('iframe[title="Mapped Vite preview"]'),frame=page.frameLocator('iframe[title="Mapped Vite preview"]'),button=frame.locator('#action');
  await button.waitFor({timeout:360000});await page.waitForFunction(()=>!document.querySelector('.frame-runtime-feedback'));
  const activate=async(name:string)=>{await page.getByRole('button',{name,exact:true}).focus();await page.keyboard.press('Enter');};
  await activate('3 live frames');await page.waitForFunction(()=>document.querySelectorAll('iframe[data-live-frame-id]').length===3&&!document.querySelector('.frame-runtime-feedback'));
  await activate('1 live frames');await new Promise(resolve=>setTimeout(resolve,60000));
  await activate('3 live frames');await page.waitForFunction(()=>document.querySelectorAll('iframe[data-live-frame-id]').length===3&&!document.querySelector('.frame-runtime-feedback'));
  await frame.locator('body').evaluate(()=>{
    const root=window as unknown as {pointerAudit:Array<Record<string,unknown>>};root.pointerAudit=[];
    addEventListener('pointerdown',event=>{const el=event.target as Element;root.pointerAudit.push({tag:el.localName,id:el.id,x:event.clientX,y:event.clientY,trusted:event.isTrusted});root.pointerAudit=root.pointerAudit.slice(-30);},true);
  });
  for(const scale of [.65,.82,1,.6]){
    await iframe.evaluate((el,scale)=>{const frame=el as HTMLIFrameElement;frame.style.transform=`scale(${scale})`;frame.parentElement!.style.height=`${900*scale}px`;},scale);
    for(const method of ['locator','screen'] as const){
      await activate('Select elements');await button.focus();await page.keyboard.press('Enter');
      await expect.poll(()=>page.evaluate(()=>window.anchorTest.snapshot()?.selection?.tag)).toBe('button');
      await activate('Enable interactions');await frame.locator('[data-ah-inspector]').waitFor({state:'detached'});
      // Focus/locator scrolling can tuck the target under the fixture toolbar.
      // Reset both scroll roots before measuring a genuinely exposed target.
      await frame.locator('body').evaluate(()=>scrollTo(0,0));await page.evaluate(()=>scrollTo(0,0));
      await expect.poll(()=>frame.locator('body').evaluate(()=>scrollY)).toBe(0);
      const before=Number(await frame.locator('output').textContent());
      const outer=await iframe.boundingBox(),locator=await button.boundingBox();
      const metrics=await iframe.evaluate(el=>({width:(el as HTMLElement).offsetWidth,height:(el as HTMLElement).offsetHeight,left:(el as HTMLElement).clientLeft,top:(el as HTMLElement).clientTop}));
      const inner=await button.evaluate(el=>{const r=el.getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height};});
      if(!outer)throw Error('Missing iframe bounds');
      const screen={x:outer.x+(metrics.left+inner.x+inner.width/2)*outer.width/metrics.width,y:outer.y+(metrics.top+inner.y+inner.height/2)*outer.height/metrics.height};
      const parentHit=await page.evaluate(point=>{const el=document.elementFromPoint(point.x,point.y);return{tag:el?.localName,title:el?.getAttribute('title'),text:el?.textContent?.slice(0,70)};},screen);
      await frame.locator('body').evaluate(()=>{(window as unknown as {pointerAudit:unknown[]}).pointerAudit=[];});
      let actionError:string|null=null;
      try{if(method==='locator')await button.click({timeout:5000});else await page.mouse.click(screen.x,screen.y);await expect(frame.locator('output')).toHaveText(String(before+1),{timeout:2000});}catch(error){actionError=String(error);}
      const after=Number(await frame.locator('output').textContent()),events=await frame.locator('body').evaluate(()=>(window as unknown as {pointerAudit:unknown[]}).pointerAudit);
      report.checks.push({scale,method,passed:after===before+1,before,after,outer,inner,locator,screen,parentHit,events,actionError});
      console.log(JSON.stringify({scale,method,passed:after===before+1,events}));
    }
  }
  await page.screenshot({path:'outputs/audit/scaled-pointer.png'});await page.evaluate(()=>window.anchorTest.stop());report.completedAt=new Date().toISOString();
  if(report.checks.some(check=>!check.passed))process.exitCode=1;
}catch(error){report.failure=String(error);process.exitCode=1;}
finally{await browser.close();server.close();await writeFile('outputs/audit/scaled-pointer-results.json',JSON.stringify(report,null,2));console.log(JSON.stringify({checks:report.checks.length,failure:report.failure,errors:report.errors}));}
