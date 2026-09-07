import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { createServer } from 'node:http';
import { readFile,writeFile } from 'node:fs/promises';
import {radiusChecks} from './radius-checks';

const editorMode=process.argv.includes('--editor');
const radiusMode=process.argv.includes('--radius');
const report={at:new Date().toISOString(),scope:`Real WebContainer + Vite 6.4.1 + production PreviewSession/PreviewFrame/LiveInspector/${radiusMode?'MappedRadiusEditor UI':editorMode?'MappedTextEditor UI':'source helper'}. Synthetic fixture, not hosted private import, paid agent execution or production pixel verification.`,checks:[] as string[],errors:[] as string[],expectedErrors:[] as string[],events:[] as unknown[],failure:undefined as string|undefined,diagnostics:undefined as unknown};
await build({configFile:false,publicDir:false,plugins:[react()],define:{'process.env.NODE_ENV':'"production"'},logLevel:'error',build:{outDir:'outputs/audit/source-anchor-dist',emptyOutDir:true,lib:{entry:'tests/browser/source-anchor-fixture.tsx',formats:['es'],fileName:()=> 'fixture.js',cssFileName:'fixture'}}});
const directory=new URL('../../outputs/audit/source-anchor-dist/',import.meta.url);
const headers={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
const server=createServer(async(req,res)=>{try{
  if(req.url?.split('?')[0]==='/'){res.writeHead(200,{...headers,'Content-Type':'text/html'});res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script type="module" src="/fixture.js"></script></body></html>');return;}
  const path=req.url?.startsWith('/preview-tools/')?new URL('../../public/preview-tools/source-plugin.mjs',import.meta.url):new URL(req.url!.slice(1),directory);
  if(!path.pathname.startsWith(directory.pathname)&&!req.url?.startsWith('/preview-tools/'))throw Error('Not found');
  const body=await readFile(path);res.writeHead(200,{...headers,'Content-Type':req.url?.endsWith('.css')?'text/css':'text/javascript'});res.end(body);
}catch{res.writeHead(404);res.end();}});
await new Promise<void>(resolve=>server.listen(8793,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true,executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
const page=await browser.newPage({viewport:{width:1440,height:1000}});
const networkIssues:Array<{url:string;error:string}>=[];
const safeUrl=(raw:string)=>{try{const url=new URL(raw);return url.origin+url.pathname;}catch{return 'invalid URL';}};
page.on('requestfailed',request=>{if(networkIssues.length<15)networkIssues.push({url:safeUrl(request.url()),error:(request.failure()?.errorText??'failed').slice(0,200)});});
page.on('response',response=>{if(response.status()>=400&&networkIssues.length<15)networkIssues.push({url:safeUrl(response.url()),error:`HTTP ${response.status()}`});});
page.on('pageerror',error=>(editorMode&&error.message==='Intentional source render failure'?report.expectedErrors:report.errors).push(error.message));
try{
  await page.goto('http://127.0.0.1:8793'+(editorMode||radiusMode?'/?editor=1':''));await page.waitForFunction(()=>Boolean(window.anchorTest));
  assert.equal(await page.evaluate(()=>crossOriginIsolated),true);
  await page.getByRole('button',{name:'Start browser runtime',exact:true}).click();
  await page.waitForFunction(()=>window.anchorTest.events.some((event)=>{const value=event as {status:string};return ['ready','error'].includes(value.status);}),{},{timeout:360_000});
  report.events=await page.evaluate(()=>window.anchorTest.events);
  assert.ok(report.events.some(event=>(event as {status:string}).status==='ready'),JSON.stringify(report.events));
  const frame=page.frameLocator('iframe[title="Mapped Vite preview"]');
  await frame.getByRole('button',{name:'Start',exact:true}).waitFor({timeout:90_000});
  assert.equal(await frame.locator('body').getAttribute('data-config'),'true');
  assert.equal(await page.evaluate(()=>window.anchorTest.read('predev.txt')),'preserved');
  report.checks.push('One actual WebContainer starts the original Vite script; predev hook, custom root, alias, React plugin and define survive config wrapping');
  await frame.locator('#action').click();
  await page.getByRole('button',{name:'Open JSX',exact:true}).waitFor();
  const anchor=await page.evaluate(()=>window.anchorTest.snapshot()!.selection!.source!);
  assert.equal(anchor.file,'src/components/Action.tsx');assert.equal(anchor.tag,'button');
  await page.getByRole('button',{name:'Open JSX',exact:true}).click();
  await page.locator('#opened').filter({hasText:'src/components/Action.tsx:2'}).waitFor();
  assert.match(await page.locator('#opened').innerText(),/<button/);
  assert.equal(await frame.locator('output').textContent(),'0');
  const source=await page.evaluate(path=>window.anchorTest.read(path),anchor.file);assert.ok(!source.includes('data-ah-source'));
  report.checks.push('Selecting the real button yields its component (not route guess), opening verifies file hash/AST, and authoritative source contains no instrumentation');
  if(radiusMode){await radiusChecks(page,report,source,anchor);}
  else if(editorMode){
    const mobile=page.frameLocator('iframe[title="Shared mobile component"]');await mobile.locator('#action').waitFor();
    await page.getByRole('button',{name:'Interact',exact:true}).click();await frame.locator('#action').click();assert.equal(await frame.locator('output').textContent(),'1');await page.getByRole('button',{name:'Select',exact:true}).click();
    await page.getByRole('button',{name:'Edit text',exact:true}).click();
    const field=page.getByRole('textbox',{name:'Selected text',exact:true});await field.fill('Begin & grow');
    await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('Text verified on this page.',{exact:true}).waitFor();
    assert.equal(await frame.locator('#action').textContent(),'Begin & grow');assert.equal(await mobile.locator('#action').textContent(),'Begin & grow');assert.equal(await frame.locator('h1').textContent(),'Start');
    assert.equal(await frame.locator('output').textContent(),'1');assert.equal(await mobile.locator('output').textContent(),'0');
    report.checks.push('Actual inspector Edit text → Apply changes only the exact static JSX child, both live viewport instances update, and success waits for the matching render');
    await page.getByRole('button',{name:'Undo text edit',exact:true}).click();await page.getByText('Undo verified.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),source);assert.equal(await frame.locator('#action').textContent(),'Start');
    assert.equal(await frame.locator('output').textContent(),'1');
    report.checks.push('Actual inspector Undo restores source exactly and verifies the restored live text');
    const newer=source.replace('<h1>Start</h1>','<h1>Newer work</h1>');await page.evaluate(text=>window.anchorTest.externalChange(text),newer);await frame.getByRole('heading',{name:'Newer work'}).waitFor();
    await field.fill('Do not overwrite');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.locator('.mapped-text-editor [role="alert"]').filter({hasText:'Source conflict'}).waitFor();
    assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),newer);assert.equal(await frame.locator('#action').textContent(),'Start');
    report.checks.push('An external source edit after opening the inspector blocks Apply without overwriting it');
    await page.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:'Refresh elements',exact:true}).click();await page.getByRole('button',{name:'Edit text',exact:true}).click();await field.fill('Cancelled copy');
    await frame.locator('#action').evaluate(element=>{(element as HTMLElement).style.opacity='0';});
    await page.getByRole('button',{name:'Apply',exact:true}).click();
    await frame.getByRole('button',{name:'Cancelled copy'}).waitFor({state:'attached'});
    await page.waitForTimeout(750); // Allow several real render-check cycles; absence immediately after HMR is not evidence.
    assert.equal(await page.getByText('Text verified on this page.',{exact:true}).count(),0);
    await page.getByRole('button',{name:'Stop',exact:true}).click();await page.getByText('Cancelled. Previous source restored.',{exact:true}).waitFor();
    assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),newer);
    report.checks.push('Hidden output is not verified; Stop during render validation restores previous source and draft');
    await frame.locator('#action').evaluate(element=>{(element as HTMLElement).style.opacity='1';});
    await field.fill('Successful retry');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('Text verified on this page.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Undo text edit',exact:true}).click();await page.getByText('Undo verified.',{exact:true}).waitFor();
    await page.screenshot({path:'outputs/audit/live-text-editor.png',timeout:10000});
    assert.equal(await page.evaluate(()=>window.anchorTest.diagnostics()?.processes),1);
    report.checks.push('After cancellation, retry and undo succeed with two live frames sharing one runtime/dev process');
    await page.getByRole('button',{name:'Close',exact:true}).click();await frame.locator('#formatted').click();await page.getByRole('button',{name:'Edit text',exact:true}).click();
    assert.equal(await field.inputValue(),'Hello world');await field.fill('New paragraph');await page.getByRole('button',{name:'Apply',exact:true}).click();await page.getByText('Text verified on this page.',{exact:true}).waitFor();
    await page.getByRole('button',{name:'Undo text edit',exact:true}).click();await page.getByText('Undo verified.',{exact:true}).waitFor();
    assert.equal(await frame.locator('#formatted').textContent(),'Hello world');assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),newer);
    report.checks.push('JSX indentation is normalized as rendered text in the editor; Apply and Undo restore both visible copy and byte-exact formatted source');
    await page.getByRole('button',{name:'Close',exact:true}).click();await frame.locator('#action').click();await page.getByRole('button',{name:'Edit text',exact:true}).click();
    await field.fill('Trigger render error');await page.getByRole('button',{name:'Apply',exact:true}).click();
    await page.locator('.frame-runtime-feedback.error').first().waitFor();
    assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),newer);
    assert.equal(await page.getByText('Text verified on this page.',{exact:true}).count(),0);
    assert.ok(report.expectedErrors.length>0);
    report.checks.push('An intentional real React layout-effect exception fails the render gate, restores the previous source and shows preview errors instead of success');
    await page.screenshot({path:'outputs/audit/text-editor-rollback-error.png',timeout:10000});
  }else{
  await page.getByRole('button',{name:'Interact',exact:true}).click();await frame.locator('#action').click();
  assert.equal(await frame.locator('output').textContent(),'1');
  const edit=await page.evaluate(anchor=>window.anchorTest.roundtrip(anchor),anchor);
  await frame.getByRole('button',{name:'Begin now',exact:true}).waitFor({timeout:30_000});
  assert.equal(await frame.locator('h1').textContent(),'Start');assert.equal(await frame.locator('output').textContent(),'1');
  assert.equal(await page.evaluate(path=>window.anchorTest.read(path),anchor.file),edit.patch.output);
  await page.waitForFunction(hash=>window.anchorTest.snapshot()?.selection?.source?.hash !== hash && Boolean(window.anchorTest.snapshot()?.selection?.source),anchor.hash);
  const updated=await page.evaluate(()=>window.anchorTest.snapshot()!.selection!.source!);
  await page.evaluate(async anchor=>window.anchorTest.verify(await window.anchorTest.read(anchor.file),anchor),updated);
  const stale=await page.evaluate(async anchor=>{try{await window.anchorTest.verify(await window.anchorTest.read(anchor.file),anchor);return '';}catch(error){return String(error);}},anchor);
  assert.match(stale,/older source/);
  report.checks.push('Exact selected text span updates through real Vite HMR without changing duplicate heading or component state; source marker refreshes automatically and stale markers reject');
  const original=await page.evaluate(({path,patch})=>window.anchorTest.inverse(path,patch),{path:anchor.file,patch:edit.patch.inversePatch});
  assert.equal(original,source);await frame.getByRole('button',{name:'Start',exact:true}).waitFor();assert.equal(await frame.locator('output').textContent(),'1');
  report.checks.push('Inverse source patch restores exact source and actual button through HMR');
  await page.screenshot({path:'outputs/audit/live-jsx-source.png',timeout:10000});
  }
  assert.deepEqual(report.errors,[]);
}catch(error){report.failure=String(error);Object.assign(report,{networkIssues,frameUrls:page.frames().map(frame=>safeUrl(frame.url()))});await page.screenshot({path:`outputs/audit/${radiusMode?'radius':'text'}-browser-failed.png`,timeout:10000}).catch(()=>{});process.exitCode=1;}
finally{
  report.events=await page.evaluate(()=>window.anchorTest?.events).catch(()=>[]);
  report.diagnostics=await page.evaluate(()=>window.anchorTest?.diagnostics()).catch(()=>null);
  await page.evaluate(()=>window.anchorTest?.stop()).catch(()=>undefined);
  await browser.close();server.close();
  await writeFile(`outputs/audit/${radiusMode?'source-radius-editor':editorMode?'source-text-editor':'source-anchor'}-browser-results.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
