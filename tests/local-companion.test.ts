import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, request } from 'node:http';
import { createLocalCompanion, safeLocalSourcePath } from '../runtime/local-companion';

test('local source scope excludes secrets, traversal, dependencies and workflows',()=>{
  for(const value of ['../other.tsx','.env','.git/config','.github/workflows/ci.yml','node_modules/secret.js','next.config.ts','package.json','src/credentials.json'])assert.throws(()=>safeLocalSourcePath(value));
  assert.equal(safeLocalSourcePath('app/home/page.tsx'),'app/home/page.tsx');
});
test('paired local preview: origin/auth/revision checks, protected iframe, source transaction and exact rollback',async()=>{
  const root=await mkdtemp(join(tmpdir(),'design-harness-companion-test-'));
  const outside=await mkdtemp(join(tmpdir(),'design-harness-companion-outside-'));
  const original='export default function Page(){return <button>Original</button>}';
  await writeFile(join(root,'page.tsx'),original);await writeFile(join(outside,'secret.tsx'),'private');await symlink(outside,join(root,'escape'));
  let receivedCookie='',stops=0;
  const app=createServer((req,res)=>{receivedCookie=String(req.headers.cookie??'');res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><title>Fixture</title></head><body>Real response</body></html>');});
  await new Promise<void>(r=>app.listen(4889,'127.0.0.1',r));
  const origin='https://harness.example',workspaceId='fixture',ref='a'.repeat(40),repositoryUrl='https://github.com/example/fixture';
  const companion=await createLocalCompanion({source:root,origin,target:{repositoryUrl,ref,label:'fixture',changedFiles:0},controlPort:4887,previewPort:4888,code:'unit-pairing-code',start:async()=>4889,stop:async()=>{stops++;}});
  let access='',cookie='';
  const api=(path:string,body?:unknown,override:Record<string,string>={})=>fetch('http://localhost:4887'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,'Content-Type':'application/json',...(access?{Authorization:'Bearer '+access}:{}),...override},...(body===undefined?{}:{body:JSON.stringify(body)})});
  try{
    assert.equal((await api('/status')).status,401);
    assert.equal((await api('/status',undefined,{Origin:'https://evil.example'})).status,403);
    const rebound=await new Promise<number|undefined>((yes,no)=>{const req=request({host:'127.0.0.1',port:4887,path:'/status',headers:{Host:'rebind.example:4887',Origin:origin}},res=>{res.resume();yes(res.statusCode);});req.on('error',no);req.end();});assert.equal(rebound,403);
    assert.equal((await api('/pair',{code:'unit-pairing-code',repositoryUrl,ref:'b'.repeat(40),workspaceId,trusted:true})).status,409);
    const pair=await api('/pair',{code:'unit-pairing-code',repositoryUrl,ref,workspaceId,trusted:true});assert.equal(pair.status,200);
    const value=await pair.json() as {access:string};access=value.access;
    const setCookie=pair.headers.get('set-cookie')!;for(const flag of ['HttpOnly','Secure','SameSite=None','Partitioned'])assert.ok(setCookie.includes(flag));cookie=setCookie.split(';')[0];
    assert.equal((await api('/pair',{code:'unit-pairing-code',repositoryUrl,ref,workspaceId,trusted:true})).status,401);
    const unauthorized=await fetch('http://localhost:4888/');assert.equal(unauthorized.status,401);
    assert.equal((await api('/start',{workspaceId:'other'})).status,403);
    assert.equal((await api('/start',{workspaceId})).status,202);
    const preview=await fetch('http://localhost:4888/?__ah_frame=home',{headers:{Cookie:cookie}});
    assert.equal(preview.status,200);const html=await preview.text();assert.ok(html.startsWith('<!doctype html>'));assert.match(html,/<head><script src="\/__design_harness_bridge.js"/);assert.ok(!receivedCookie.includes('__Host-design-harness'));
    assert.equal(preview.headers.get('content-security-policy'),'frame-ancestors '+origin);
    assert.equal((await api('/read',{workspaceId,path:'escape/secret.tsx'})).status,400);
    const changed=original.replace('Original','Edited'),change={path:'page.tsx',before:original,after:changed};
    assert.equal((await api('/apply',{workspaceId,changes:[change],approved:false})).status,400);
    let result=await api('/apply',{workspaceId,changes:[change],approved:true});assert.equal(result.status,200);let transaction=(await result.json() as {transaction:string}).transaction;
    assert.equal(await readFile(join(root,'page.tsx'),'utf8'),changed);
    assert.equal((await api('/apply',{workspaceId,changes:[change],approved:true})).status,400);
    assert.equal((await api('/rollback',{workspaceId,transaction})).status,200);assert.equal(await readFile(join(root,'page.tsx'),'utf8'),original);
    result=await api('/apply',{workspaceId,changes:[change],approved:true});transaction=(await result.json() as {transaction:string}).transaction;
    assert.equal((await api('/commit',{workspaceId,transaction})).status,200);assert.equal(await readFile(join(root,'page.tsx'),'utf8'),changed);
    assert.equal((await api('/apply',{workspaceId,changes:[change],approved:true})).status,400);
    assert.equal((await api('/disconnect',{workspaceId})).status,200);assert.ok(stops>0);assert.equal((await api('/status')).status,401);
  }finally{await companion.close();app.closeAllConnections();await new Promise<void>(r=>app.close(()=>r()));await rm(root,{recursive:true});await rm(outside,{recursive:true});}
});
