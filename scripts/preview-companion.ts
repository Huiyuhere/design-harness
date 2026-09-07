import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { readFile, realpath, statfs } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { createLocalCompanion } from '../runtime/local-companion';
import { createServer as createPortProbe } from 'node:net';

const args=process.argv.slice(2);
const option=(name:string)=>{const index=args.indexOf(name);return index<0?undefined:args[index+1];};
const sourceArg=option('--source'),origin=option('--origin')??'https://agent-harness.superhumanbrains.chatgpt.site';
if(!sourceArg||!args.includes('--trust-local-code'))throw new Error('Usage: pnpm companion --source /absolute/path/to/a-disposable-git-copy --trust-local-code [--origin https://your-site]. Repository scripts run as your user, not in an OS sandbox. Never point at your original working repository.');
const source=await realpath(resolve(sourceArg));
const git=(...args:string[])=>execFileSync('git',['-C',source,...args],{encoding:'utf8'}).trim();
if(await realpath(git('rev-parse','--show-toplevel'))!==source)throw new Error('Select a separate Git working copy, not a subdirectory.');
let remote=git('remote','get-url','origin');
// A disposable local clone may retain its original local repository as origin.
// Resolve that single metadata hop; never read credentials or follow URL chains.
if(remote.startsWith('/'))remote=execFileSync('git',['-C',remote,'remote','get-url','origin'],{encoding:'utf8'}).trim();
const match=remote.match(/^(?:https:\/\/github\.com\/|git@github\.com:)([\w.-]+)\/([\w.-]+?)(?:\.git)?$/);
if(!match)throw new Error('The selected copy needs a GitHub origin without embedded credentials.');
const target={repositoryUrl:`https://github.com/${match[1]}/${match[2]}`,ref:git('rev-parse','HEAD'),label:source.split('/').at(-1)!,changedFiles:git('status','--porcelain','--untracked-files=no').split('\n').filter(Boolean).length};
const pkg=JSON.parse(await readFile(resolve(source,'package.json'),'utf8'));
const dev=String(pkg.scripts?.dev??'').trim();
if(!['next dev','vite'].includes(dev))throw new Error('Local runner currently supports standard next dev and vite scripts. Custom dev scripts need a reviewed adapter.');
const require=createRequire(resolve(source,'package.json'));
const executable=dev==='next dev'?require.resolve('next/dist/bin/next'):resolve(dirname(require.resolve('vite/package.json')),'bin/vite.js');
const appPort=4879;
let child:ReturnType<typeof spawn>|null=null;
async function stop(){const running=child;child=null;if(!running||running.exitCode!==null)return;running.kill('SIGTERM');await new Promise<void>(done=>{const timer=setTimeout(()=>{running.kill('SIGKILL');done();},5000);running.once('exit',()=>{clearTimeout(timer);done();});});}
const companion=await createLocalCompanion({source,origin,target,async start(log,signal){
  const disk=await statfs(source);if(Number(disk.bavail)*Number(disk.bsize)<2*1024*1024*1024)throw new Error('Free at least 2 GiB before running the local preview.');
  await new Promise<void>((yes,no)=>{const probe=createPortProbe();probe.once('error',()=>no(new Error('Port 4879 is already occupied.')));probe.listen(appPort,'127.0.0.1',()=>probe.close(()=>yes()));});
  // Dependencies must already be installed in this explicit trusted working copy.
  // No browser-triggered installs, shell strings, cloud credentials or parent env.
  const runArgs=dev==='next dev'?['--webpack','--hostname','127.0.0.1','--port',String(appPort)]:['--host','127.0.0.1','--port',String(appPort),'--strictPort'];
  child=spawn(process.execPath,[executable,...(dev==='next dev'?['dev']:[]),...runArgs],{cwd:source,env:{PATH:process.env.PATH,NODE_ENV:'development',NEXT_TELEMETRY_DISABLED:'1',NO_COLOR:'1'},stdio:['ignore','pipe','pipe']});
  let announced=false;
  const owned=child;owned.stdout?.on('data',data=>{const text=data.toString();if(/Ready in|Local:/.test(text))announced=true;log(text);});owned.stderr?.on('data',data=>log(data.toString()));
  signal.addEventListener('abort',()=>{void stop();},{once:true});
  const started=Date.now();
  while(Date.now()-started<120000){
    signal.throwIfAborted();if(owned.exitCode!==null)throw new Error('Page server exited.');
    if(announced)try{const result=await fetch(`http://127.0.0.1:${appPort}/`,{signal:AbortSignal.any([signal,AbortSignal.timeout(3000)])});await result.body?.cancel();if(result.status<500&&owned.exitCode===null)return appPort;}catch{ /* The first route may still be compiling. */ }
    await new Promise(r=>setTimeout(r,500));
  }
  await stop();throw new Error('The first page did not respond within two minutes.');
},stop});
console.log(`Design Harness local companion\nCopy: ${source}\nRepository: ${target.repositoryUrl}\nRevision: ${target.ref}\nWorking-copy changes: ${target.changedFiles}\nControl: ${companion.controlOrigin}\nPreview: ${companion.previewOrigin}\nPairing code (one use, 15 minutes): ${companion.code}\nOnly ${origin} can pair. Stop with Ctrl+C. No repository is pushed.`);
process.once('SIGINT',()=>{void companion.close().finally(()=>process.exit(0));});
process.once('SIGTERM',()=>{void companion.close().finally(()=>process.exit(0));});
