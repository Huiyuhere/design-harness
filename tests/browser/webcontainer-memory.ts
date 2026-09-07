import assert from 'node:assert/strict';
import {chromium,expect,type Page} from '@playwright/test';
import {build} from 'vite';
import react from '@vitejs/plugin-react';
import {createServer} from 'node:http';
import {readFile,writeFile,statfs,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';

const smoke=process.argv.includes('--smoke'),duration=smoke?60_000:20*60_000;
const output=`outputs/audit/webcontainer-memory${smoke?'-smoke':''}-results.json`;
const result={startedAt:new Date().toISOString(),completedAt:null as string|null,productRevision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),scope:'Real WebContainer + production PreviewSession/PreviewFrame/LiveInspector, synthetic Vite React app with 150 rows and nested scrolling. Not Finite, hosted import, paid AI or production pixel acceptance.',methodology:'Fresh dedicated headless Chromium; CSS viewports 1440×900, 390×844 and 768×1024. CDP process IDs intersect macOS RSS. Sum of resident mappings is not physical footprint; shared pages/compression can distort totals. WebContainer runs inside browser workers, so renderer-process RSS includes runtime allocations and cannot cleanly isolate imported page RAM. Per-target JS heap may overlap and is not summed. No forced garbage collection. Global swap/pressure are not solely attributable to this test.',requestedSustainedSeconds:duration/1000,sustainedSeconds:0,cycles:0,checks:[] as string[],samples:[] as Array<Record<string,unknown>>,gestures:[] as Array<{kind:string;elapsedMs:number}>,errors:[] as string[],failure:null as string|null,buildFiles:[] as Array<{file:string;bytes:number;sha256:string}>};
const save=()=>writeFile(output,JSON.stringify(result,null,2));
const sleep=(ms:number)=>new Promise(resolve=>setTimeout(resolve,ms));
await build({configFile:false,publicDir:false,plugins:[react()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:'outputs/audit/memory-dist',emptyOutDir:true,lib:{entry:'tests/browser/source-anchor-fixture.tsx',formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}});
const directory=new URL('../../outputs/audit/memory-dist/',import.meta.url);
for(const file of await readdir(directory)){const bytes=await readFile(new URL(file,directory));result.buildFiles.push({file,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});}
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
const server=createServer(async(req,res)=>{try{
  if(req.url?.split('?')[0]==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');return;}
  const path=req.url==='/preview-tools/source-plugin.mjs'?new URL('../../public/preview-tools/source-plugin.mjs',import.meta.url):new URL(req.url!.slice(1),directory);
  if(!path.pathname.startsWith(directory.pathname)&&req.url!=='/preview-tools/source-plugin.mjs')throw Error('Not found');
  const body=await readFile(path);res.writeHead(200,{...headers,'Content-Type':req.url?.endsWith('.css')?'text/css':'text/javascript'});res.end(body);
}catch{res.writeHead(404);res.end();}});
await new Promise<void>(resolve=>server.listen(8793,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
let page:Page|undefined;
try{
  const context=await browser.newContext({viewport:{width:1600,height:1000}});page=await context.newPage();const activePage=page;
  page.setDefaultTimeout(25000);page.on('pageerror',error=>{if(result.errors.length<20)result.errors.push(error.message);});
  const browserCDP=await browser.newBrowserCDPSession(),hostCDP=await context.newCDPSession(page);
  const sample=async(label:string)=>{
    const all=execFileSync('/bin/ps',['-axo','pid=,rss='],{encoding:'utf8'}).trim().split('\n').map(line=>line.trim().split(/\s+/).map(Number)),rss=new Map(all.map(([pid,bytes])=>[pid,bytes]));
    const processes=(await browserCDP.send('SystemInfo.getProcessInfo')).processInfo as Array<{id:number;type:string}>;
    const processRows=processes.map(p=>({pid:p.id,type:p.type,rssMiB:(rss.get(p.id)??0)/1024}));
    const pageHeaps:Array<Record<string,unknown>>=[];
    for(const frame of activePage.frames().filter(frame=>/[?&]__ah_frame=/.test(frame.url()))){const cdp=await context.newCDPSession(frame);try{const heap=await cdp.send('Runtime.getHeapUsage'),dom=await cdp.send('Memory.getDOMCounters');pageHeaps.push({frame:new URL(frame.url()).searchParams.get('__ah_frame'),usedMiB:heap.usedSize/1048576,totalMiB:heap.totalSize/1048576,dom});}finally{await cdp.detach();}}
    const hostHeap=await hostCDP.send('Runtime.getHeapUsage'),hostDom=await hostCDP.send('Memory.getDOMCounters');
    const disk=await statfs('.'),freeGiB=disk.bavail*disk.bsize/1073741824;
    const pressure=execFileSync('/usr/bin/memory_pressure',['-Q'],{encoding:'utf8'}).trim();
    const browserRSSMiB=processRows.reduce((n,p)=>n+p.rssMiB,0),rendererRSSMiB=processRows.filter(p=>p.type==='renderer').reduce((n,p)=>n+p.rssMiB,0);
    const s={label,at:new Date().toISOString(),appFrames:await activePage.locator('iframe[data-live-frame-id]').count(),allTopLevelIframes:await activePage.locator('iframe').count(),browserRSSMiB,rendererRSSMiB,hostHeapMiB:hostHeap.usedSize/1048576,hostDom,pageHeaps,processes:processRows,freeGiB,pressure,swap:execFileSync('/usr/sbin/sysctl',['vm.swapusage'],{encoding:'utf8'}).trim(),runtimeProcesses:await activePage.evaluate(()=>window.anchorTest?.diagnostics()?.processes??0)};
    result.samples.push(s);await save();console.log(JSON.stringify({label,frames:s.appFrames,browserMiB:Math.round(browserRSSMiB),rendererMiB:Math.round(rendererRSSMiB),hostHeapMiB:Math.round(s.hostHeapMiB),cycles:result.cycles,freeGiB:Math.round(freeGiB*10)/10}));
    assert.ok(freeGiB>1.5,'Safety stop: less than 1.5 GiB disk headroom');assert.ok(browserRSSMiB<5000,'Safety stop: dedicated browser exceeds 5,000 MiB RSS');
    const percent=Number(pressure.match(/free percentage:\s*([\d.]+)/)?.[1]);if(Number.isFinite(percent))assert.ok(percent>=3,'Safety stop: system free-memory percentage below 3');
    assert.deepEqual(result.errors,[]);
  };
  await page.goto('http://127.0.0.1:8793/?memory=1');await page.waitForFunction(()=>Boolean(window.anchorTest));assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  await sample('host-before-runtime');await page.getByRole('button',{name:'Start browser runtime',exact:true}).click();
  await page.waitForFunction(()=>window.anchorTest.events.some(event=>['ready','error'].includes((event as {status:string}).status)),{},{timeout:360000});
  const frame=page.frameLocator('iframe[title="Mapped Vite preview"]');await frame.locator('#action').waitFor({timeout:90000});await page.waitForFunction(()=>!document.querySelector('.frame-runtime-feedback'));
  const source=await page.evaluate(()=>window.anchorTest.read('src/components/Action.tsx'));
  const waitFrames=async(count:number)=>{await activePage.getByRole('button',{name:`${count} live frames`,exact:true}).click();await activePage.waitForFunction(count=>document.querySelectorAll('iframe[data-live-frame-id]').length===count,count);await activePage.waitForFunction(()=>!document.querySelector('.frame-runtime-feedback'));assert.equal(await activePage.evaluate(()=>window.anchorTest.diagnostics()?.processes),1);};
  for(const count of [1,2,3]){await waitFrames(count);for(let i=0;i<(smoke?1:3);i++){await sleep(smoke?1000:5000);await sample(`${count}-live-${i+1}`);}}
  result.checks.push('One, two and three responsive app frames connect while sharing exactly one dev process');
  await page.screenshot({path:`outputs/audit/webcontainer-memory${smoke?'-smoke':''}-three.png`});
  await waitFrames(1);for(const seconds of smoke?[1]:[15,30,60]){await sleep(smoke?1000:(seconds===15?15000:seconds===30?15000:30000));await sample(`demoted-one-${seconds}s`);}
  await waitFrames(3);
  // Keyboard activation avoids the separately retained scaled-iframe pointer
  // coordinate failure. This benchmark does not certify pointer accuracy.
  await frame.locator('#action').focus();await page.keyboard.press('Enter');
  await expect.poll(()=>page!.evaluate(()=>window.anchorTest.snapshot()?.selection?.tag)).toBe('button');
  await page.getByRole('button',{name:'Enable interactions',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Enable interactions',exact:true})).toHaveAttribute('aria-pressed','true');
  await frame.locator('#action').focus();await page.keyboard.press('Enter');await expect(frame.locator('output')).toHaveText('1');await page.getByRole('button',{name:'Select elements',exact:true}).focus();await page.keyboard.press('Enter');await expect(page.getByRole('button',{name:'Select elements',exact:true})).toHaveAttribute('aria-pressed','true');
  const began=Date.now();await sample('sustained-start');
  while(Date.now()-began<duration){
    const cycle=Date.now(),text=result.cycles%2===0;
    await frame.locator('body').evaluate(()=>scrollTo(0,0));await activePage.getByRole('button',{name:'Refresh elements',exact:true}).click();
    if(text){await page.getByRole('button',{name:'Edit text',exact:true}).click();await page.getByRole('textbox',{name:'Selected text',exact:true}).fill(`Iteration ${result.cycles}`);const start=Date.now();await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('Text verified on this page.',{exact:true}).waitFor();result.gestures.push({kind:'text',elapsedMs:Date.now()-start});await page.getByRole('button',{name:'Undo text edit',exact:true}).click();await page.getByText('Undo verified.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close',exact:true}).click();}
    else{await page.getByRole('button',{name:'Edit corners',exact:true}).click();await page.getByRole('checkbox',{name:'Override this element at all sizes',exact:true}).check();const start=Date.now();await page.getByRole('button',{name:'Apply radius',exact:true}).click();await page.getByText('Radius verified on this page.',{exact:true}).waitFor();result.gestures.push({kind:'radius',elapsedMs:Date.now()-start});await page.getByRole('button',{name:'Undo radius edit',exact:true}).click();await page.getByText('Corners restored.',{exact:true}).waitFor();await page.getByRole('button',{name:'Close corners',exact:true}).click();}
    assert.equal(await page.evaluate(()=>window.anchorTest.read('src/components/Action.tsx')),source);assert.equal(await frame.locator('output').textContent(),'1');
    await frame.locator('#nested').evaluate(el=>{el.scrollTop=400;scrollTo(0,600);});
    assert.equal(await frame.locator('#nested').evaluate(el=>el.scrollTop),400);
    result.cycles++;result.sustainedSeconds=(Date.now()-began)/1000;await sample(`editing-${Math.round(result.sustainedSeconds)}s`);await sleep(Math.max(0,(smoke?10000:30000)-(Date.now()-cycle)));
  }
  result.sustainedSeconds=(Date.now()-began)/1000;await sample('sustained-end');
  result.checks.push(`${result.cycles} alternating text/corner Apply→Undo cycles preserved byte-exact source and active React state over ${Math.round(result.sustainedSeconds)} seconds`);
  await waitFrames(1);await sleep(smoke?1000:30000);await sample('post-edit-demoted-one');await waitFrames(0);await sleep(smoke?1000:30000);await sample('warm-runtime-zero-app-frames');
  await page.evaluate(()=>window.anchorTest.stop());await sleep(smoke?1000:15000);await sample('runtime-stopped');result.completedAt=new Date().toISOString();
}catch(error){result.failure=String(error);process.exitCode=1;console.error(result.failure);if(page)await page.screenshot({path:`outputs/audit/webcontainer-memory${smoke?'-smoke':''}-failed.png`,timeout:5000}).catch(()=>{});}
finally{await save();if(page)await page.evaluate(()=>window.anchorTest?.stop()).catch(()=>{});await browser.close();server.close();}
