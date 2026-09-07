import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFile, realpath, lstat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import { resolve, dirname, relative, sep } from 'node:path';
import { buildPreviewBridge } from '../lib/preview-bridge';
import { safeRepositoryPath } from '../lib/archive-policy';
import { parse } from '@babel/parser';
import postcss from 'postcss';
import { Transform } from 'node:stream';
import type { SourceChange } from '../lib/preview-drafts';

export type LocalTarget = { repositoryUrl: string; ref: string; label: string; changedFiles: number };
type Options = { source: string; origin: string; target: LocalTarget; code?: string; controlPort?: number; previewPort?: number;
  start(log: (text:string)=>void, signal:AbortSignal): Promise<number>; stop(): Promise<void> };
const token = () => randomBytes(32).toString('base64url');
const equal = (a:string,b:string) => {const left=Buffer.from(a),right=Buffer.from(b);return left.length===right.length&&timingSafeEqual(left,right);};
const cookieName = '__Host-design-harness-preview';
const repository = (value:string) => value.replace(/\.git$/, '').replace(/\/$/,'').toLowerCase();
export function safeLocalSourcePath(path: string) {
  safeRepositoryPath(path);
  if (path.split('/').some(p=>p.startsWith('.') || ['node_modules','dist','build','coverage'].includes(p)) || !/\.(?:[cm]?[jt]sx?|css|md|html|json)$/.test(path) || /(?:^|\/)(?:package(?:-lock)?\.json|[^/]*config\.[^/]+|.*(?:secret|credential).*|.*\.pem)$/i.test(path)) throw new Error('This file is outside the editable source scope.');
  return path;
}
async function sourcePath(root:string,path:string) {
  safeLocalSourcePath(path);
  const full=resolve(root,path);
  // Check each existing component: a symlink must not escape the selected copy.
  let cursor=root;
  for(const part of path.split('/')) {
    cursor=resolve(cursor,part);
    try { if((await lstat(cursor)).isSymbolicLink())throw new Error('Symlink source paths are not allowed.'); }
    catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
  }
  if(relative(root,full).startsWith('..'+sep))throw new Error('Source path escaped the selected copy.');
  return full;
}
async function jsonBody(req:IncomingMessage,limit=2*1024*1024) {
  if(req.headers['content-type']?.split(';')[0]!=='application/json')throw new Error('JSON is required.');
  const chunks:Buffer[]=[];let size=0;
  for await(const part of req){size+=part.length;if(size>limit)throw new Error('Request is too large.');chunks.push(part);}
  return JSON.parse(Buffer.concat(chunks).toString());
}
function json(res:ServerResponse,status:number,value:unknown) { res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value)); }

/** Two loopback origins: authenticated control and cookie-protected app preview.
 * The browser cannot select a filesystem root, execute shell commands or install.
 * Repository scripts are trusted local code, NOT OS-sandboxed code. */
export async function createLocalCompanion(options:Options) {
  const root=await realpath(options.source), parent=new URL(options.origin);
  if(parent.origin!==options.origin || !['http:','https:'].includes(parent.protocol))throw new Error('Expected an exact Site origin.');
  const controlPort=options.controlPort ?? 4877, previewPort=options.previewPort ?? 4878;
  const controlOrigin=`http://localhost:${controlPort}`, previewOrigin=`http://localhost:${previewPort}`;
  const code=options.code ?? token();let codeUsed=false,pairFailures=0;
  const pairedAt=Date.now();let access='',previewAccess='',expires=0,workspaceId='',upstream=0;
  let state:'idle'|'starting'|'ready'|'error'='idle',message='Ready to connect',log='';
  let abort=new AbortController();let pending:{id:string;changes:SourceChange[];timer:ReturnType<typeof setTimeout>}|null=null;
  const journal=resolve(root,'.design-harness-companion','pending.json');
  let tail=Promise.resolve();
  function serial<T>(fn:()=>Promise<T>){const next=tail.then(fn);tail=next.then(()=>undefined,()=>undefined);return next;}
  const currentText=async(path:string)=>{try{const full=await sourcePath(root,path);if((await lstat(full)).size>1024*1024)throw new Error('Source file exceeds 1 MiB.');return await readFile(full,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}};
  const put=async(path:string,content:string|null)=>{const full=await sourcePath(root,path);if(content===null){await unlink(full).catch(e=>{if(e.code!=='ENOENT')throw e;});return;}await mkdir(dirname(full),{recursive:true});const temp=full+'.ah-'+randomBytes(6).toString('hex');await writeFile(temp,content,{flag:'wx',mode:0o600});await rename(temp,full);};
  async function rollback(changes:SourceChange[]){
    for(const change of changes){const text=await currentText(change.path);if(text!==change.after&&text!==change.before)throw new Error('A newer source change prevents safe rollback. Source was preserved.');}
    for(const change of [...changes].reverse())await put(change.path,change.before);
    await unlink(journal).catch(e=>{if(e.code!=='ENOENT')throw e;});
  }
  // Crash recovery is conservative: restore only the exact pending bytes.
  try { const saved=JSON.parse(await readFile(journal,'utf8')); if(!Array.isArray(saved.changes)||saved.changes.length>20)throw new Error('Invalid recovery journal.');await rollback(saved.changes); }
  catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
  async function stop(){abort.abort();await serial(async()=>{if(pending){clearTimeout(pending.timer);const saved=pending;pending=null;await rollback(saved.changes);}});await options.stop();upstream=0;state='idle';message='Preview stopped';}
  function authorized(req:IncomingMessage){return Date.now()<expires&&equal(String(req.headers.authorization??''),`Bearer ${access}`);}
  function previewAuthorized(req:IncomingMessage){return Date.now()<expires&&previewAccess&&String(req.headers.cookie??'').split(';').some(v=>equal(v.trim(),`${cookieName}=${previewAccess}`));}
  const control=createServer(async(req,res)=>{
    if(req.headers.host!==`localhost:${controlPort}` || req.headers.origin!==options.origin){json(res,403,{error:'Unpaired origin or host.'});return;}
    res.setHeader('Access-Control-Allow-Origin',options.origin);res.setHeader('Access-Control-Allow-Credentials','true');res.setHeader('Vary','Origin');
    if(req.method==='OPTIONS'){res.writeHead(204,{'Access-Control-Allow-Methods':'GET, POST','Access-Control-Allow-Headers':'Authorization, Content-Type','Access-Control-Max-Age':'300'});res.end();return;}
    try {
      if(req.url==='/pair'&&req.method==='POST'){
        const body=await jsonBody(req,4096);
        if(codeUsed||pairFailures>=5||Date.now()-pairedAt>15*60_000||typeof body.code!=='string'||!equal(body.code,code)){pairFailures++;json(res,401,{error:'Pairing code is invalid, expired or already used. Restart the companion for a new code.'});return;}
        if(repository(body.repositoryUrl??'')!==repository(options.target.repositoryUrl)||body.ref!==options.target.ref||!/^[-a-zA-Z0-9_]{1,120}$/.test(body.workspaceId)){json(res,409,{error:'This companion is for a different repository or Git revision.'});return;}
        if(body.trusted!==true){json(res,403,{error:'Approve trusted local code execution first.'});return;}
        codeUsed=true;access=token();previewAccess=token();expires=Date.now()+8*60*60_000;workspaceId=body.workspaceId;
        res.setHeader('Set-Cookie',`${cookieName}=${previewAccess}; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=28800`);
        json(res,200,{access,previewOrigin,target:options.target});return;
      }
      if(!authorized(req)){json(res,401,{error:'Connect the companion again.'});return;}
      if(req.url==='/status'&&req.method==='GET'){json(res,200,{status:state,message,log,target:options.target,workspaceId,previewOrigin});return;}
      if(req.method!=='POST'){json(res,405,{error:'Unsupported method.'});return;}
      const body=await jsonBody(req);
      if(body.workspaceId!==workspaceId){json(res,403,{error:'This workspace is not paired.'});return;}
      if(req.url==='/start'){
        if(state!=='starting'&&state!=='ready'){
          abort=new AbortController();state='starting';message='Starting the local page server…';log='';const signal=abort.signal;
          void options.start(text=>{log=(log+text).slice(-1800);},signal).then(port=>{if(!signal.aborted){upstream=port;state='ready';message='Local page server ready · checking the selected page';}},error=>{if(!signal.aborted){state='error';message=error instanceof Error&&error.message.startsWith('Free at least 2 GiB')?'Low disk space. Free at least 2 GiB before starting the local preview.':error instanceof Error&&error.message.startsWith('Port 4879')?'The preview port is already in use. Stop the other page server before retrying.':'The page server failed. Check the local terminal for details.';}});
        }
        json(res,202,{status:state,message});return;
      }
      if(req.url==='/stop'){await stop();json(res,200,{stopped:true});return;}
      if(req.url==='/disconnect'){await stop();access='';previewAccess='';expires=0;res.setHeader('Set-Cookie',`${cookieName}=; Path=/; HttpOnly; Secure; SameSite=None; Partitioned; Max-Age=0`);json(res,200,{disconnected:true});return;}
      if(req.url==='/read'){const text=await currentText(body.path);if(text===null){json(res,404,{error:'Source file not found.'});return;}if(Buffer.byteLength(text)>1024*1024)throw new Error('Source file exceeds 1 MiB.');json(res,200,{text});return;}
      if(req.url==='/apply'){
        await serial(async()=>{
          if(pending)throw new Error('Another source transaction is still validating.');
          if(body.approved!==true||!Array.isArray(body.changes)||!body.changes.length||body.changes.length>20)throw new Error('Review and approve a bounded source patch first.');
          const seen=new Set<string>();
          for(const c of body.changes){safeLocalSourcePath(c.path);if(seen.has(c.path)||typeof c.after!=='string'||(c.before!==null&&typeof c.before!=='string'))throw new Error('Invalid source patch.');seen.add(c.path);if(await currentText(c.path)!==c.before)throw new Error('Source changed since review. No patch was applied.');if(/\.[cm]?[jt]sx?$/.test(c.path))parse(c.after,{sourceType:'unambiguous',plugins:['typescript','jsx']});if(/\.css$/.test(c.path))postcss.parse(c.after);if(/\.json$/.test(c.path))JSON.parse(c.after);}
          await mkdir(dirname(journal),{recursive:true});await writeFile(journal,JSON.stringify({changes:body.changes}),{mode:0o600,flag:'wx'});
          try{for(const c of body.changes)await put(c.path,c.after);}catch(error){await rollback(body.changes);throw error;}
          const id=token();const timer=setTimeout(()=>{void serial(async()=>{if(pending?.id!==id)return;const changes=pending.changes;pending=null;try{await rollback(changes);}catch{state='error';message='An interrupted edit needs recovery. Stop editing and inspect the working copy.';}});},30000);
          pending={id,changes:body.changes,timer};json(res,200,{transaction:id});
        });return;
      }
      if(req.url==='/commit'||req.url==='/rollback'){
        await serial(async()=>{if(!pending||!equal(pending.id,body.transaction??''))throw new Error('Transaction expired or does not match.');const saved=pending;clearTimeout(saved.timer);
          if(req.url==='/rollback')await rollback(saved.changes);else{for(const c of saved.changes)if(await currentText(c.path)!==c.after)throw new Error('Source changed while validating.');await unlink(journal);}pending=null;json(res,200,{ok:true});});return;
      }
      json(res,404,{error:'Unknown companion action.'});
    } catch(error){json(res,400,{error:error instanceof Error?error.message:'Companion action failed.'});}
  });
  const bridge=buildPreviewBridge(options.origin);
  const preview=createServer((req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Cross-Origin-Embedder-Policy','credentialless');res.setHeader('Cross-Origin-Resource-Policy','cross-origin');res.setHeader('Content-Security-Policy',`frame-ancestors ${options.origin}`);
    if(req.headers.host!==`localhost:${previewPort}`||!previewAuthorized(req)){res.writeHead(401,{'Content-Type':'text/plain'});res.end('Reconnect the local companion to open this preview.');return;}
    if(!upstream){res.writeHead(503);res.end('Page server is not running.');return;}
    if(req.url==='/__design_harness_bridge.js'){res.writeHead(200,{'Content-Type':'application/javascript'});res.end(bridge);return;}
    if(req.headers.origin && ![options.origin,previewOrigin].includes(req.headers.origin)){res.writeHead(403);res.end();return;}
    const headers={...req.headers,host:`localhost:${upstream}`,'accept-encoding':'identity'};delete headers.authorization;
    headers.cookie=String(headers.cookie??'').split(';').filter(c=>!c.trim().startsWith(cookieName+'=')).join(';');
    const proxy=httpRequest({host:'127.0.0.1',port:upstream,path:req.url,method:req.method,headers},response=>{
      for(const [key,value]of Object.entries(response.headers))if(value!==undefined&&!['content-length','content-encoding','content-security-policy','x-frame-options','set-cookie','connection','cross-origin-embedder-policy','cross-origin-resource-policy','cache-control','referrer-policy'].includes(key))res.setHeader(key,value);
      res.statusCode=response.statusCode??502;
      if(String(response.headers['content-type']).includes('text/html')){
        // Preserve DOCTYPE/standards mode and stream the remainder. The bounded
        // prefix prevents large HTML/RSC responses becoming another memory copy.
        let prefix=Buffer.alloc(0),injected=false;
        const injection='<script src="/__design_harness_bridge.js"></script>'+(res.statusCode>=400?`<script>addEventListener('DOMContentLoaded',()=>{throw new Error('Page returned HTTP ${res.statusCode}');});</script>`:'');
        const transform=new Transform({transform(chunk,_encoding,done){
          if(injected){this.push(chunk);done();return;}
          prefix=Buffer.concat([prefix,chunk]);const text=prefix.toString('utf8'),head=text.match(/<head(?:\s[^>]*)?>/i);
          if(head&&head.index!==undefined){const at=Buffer.byteLength(text.slice(0,head.index+head[0].length));this.push(prefix.subarray(0,at));this.push(injection);this.push(prefix.subarray(at));prefix=Buffer.alloc(0);injected=true;}
          else if(prefix.length>65536){this.push(prefix);prefix=Buffer.alloc(0);injected=true;}
          done();
        },flush(done){if(prefix.length)this.push(prefix);done();}});
        response.pipe(transform).pipe(res);return;
      }
      response.pipe(res);
    });
    proxy.setTimeout(120000,()=>proxy.destroy(new Error('Route did not respond in time.')));
    proxy.on('error',()=>{if(!res.headersSent)res.writeHead(502);res.end('The local page server is unavailable.');});
    res.on('close',()=>proxy.destroy());req.pipe(proxy);
  });
  preview.on('upgrade',(req,socket,head)=>{
    if(req.headers.host!==`localhost:${previewPort}`||req.headers.origin!==previewOrigin||!previewAuthorized(req)||!upstream){socket.destroy();return;}
    const proxy=httpRequest({host:'127.0.0.1',port:upstream,path:req.url,headers:{...req.headers,host:`localhost:${upstream}`,cookie:''}});
    proxy.on('upgrade',(response,peer,bytes)=>{socket.write(`HTTP/1.1 101 Switching Protocols\r\n${Object.entries(response.headers).map(([k,v])=>`${k}: ${v}`).join('\r\n')}\r\n\r\n`);if(bytes.length)socket.write(bytes);if(head.length)peer.write(head);peer.pipe(socket);socket.pipe(peer);socket.on('error',()=>peer.destroy());peer.on('error',()=>socket.destroy());socket.on('close',()=>peer.destroy());});
    proxy.on('error',()=>socket.destroy());proxy.on('response',()=>socket.destroy());proxy.end();
  });
  const listen=(server:ReturnType<typeof createServer>,port:number)=>new Promise<void>((yes,no)=>{server.once('error',no);server.listen(port,'127.0.0.1',()=>yes());});
  try{await listen(control,controlPort);await listen(preview,previewPort);}catch(error){control.close();preview.close();throw error;}
  return {code,controlOrigin,previewOrigin,async close(){await stop();control.closeAllConnections();preview.closeAllConnections();await Promise.all([new Promise<void>(r=>control.close(()=>r())),new Promise<void>(r=>preview.close(()=>r()))]);}};
}
