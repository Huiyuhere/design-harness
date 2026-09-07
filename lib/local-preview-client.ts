"use client";
import type { PreviewStart, LivePreviewStatus } from './preview-session';
import type { SourceChange } from './preview-drafts';
const origin='http://localhost:4877';
let session:{access:string;workspaceId:string;previewOrigin:string;controller:AbortController;ready:boolean}|null=null;
type Reply={error?:string;access:string;previewOrigin:string;target:{label:string;changedFiles:number;ref:string};status:LivePreviewStatus;message:string;text:string;transaction:string};

async function api(path:string,body?:unknown,access=session?.access,signal?:AbortSignal){
  let response:Response;
  try{response=await fetch(origin+path,{method:body===undefined?'GET':'POST',mode:'cors',credentials:'include',cache:'no-store',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...(access?{Authorization:`Bearer ${access}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal?AbortSignal.any([signal,AbortSignal.timeout(15000)]):AbortSignal.timeout(15000)});}
  catch(error){if(signal?.aborted)throw error;throw new Error('Cannot reach the local companion. Start it on this Mac and allow this site’s local-network permission in Chrome.');}
  const value=await response.json() as Reply;if(!response.ok)throw new Error(value.error??'Local preview request failed.');return value;
}
export async function pairLocalPreview(input:{code:string;workspaceId:string;repositoryUrl:string;ref:string;trusted:boolean}){
  const value=await api('/pair',input,'');
  if(value.previewOrigin!=='http://localhost:4878'||typeof value.access!=='string')throw new Error('Unexpected companion response.');
  session={access:value.access,workspaceId:input.workspaceId,previewOrigin:value.previewOrigin,controller:new AbortController(),ready:false};
  return value.target as {label:string;changedFiles:number;ref:string};
}
export const hasLocalPreview=(workspaceId:string)=>session?.workspaceId===workspaceId;
export async function startLocalPreview(input:PreviewStart){
  const current=session;if(!current||current.workspaceId!==input.workspaceId)throw new Error('Pair this workspace with the local companion first.');
  current.controller.abort();current.controller=new AbortController();const signal=current.controller.signal;
  await api('/start',{workspaceId:input.workspaceId},current.access,signal);
  const started=Date.now();
  while(Date.now()-started<130000){
    signal.throwIfAborted();const value=await api('/status',undefined,current.access,signal);
    input.onEvent({status:value.status,message:value.message,...(value.status==='ready'?{url:current.previewOrigin}:{})});
    if(value.status==='ready'){current.ready=true;return current.previewOrigin;}
    if(value.status==='error')throw new Error(value.message);
    await new Promise(resolve=>setTimeout(resolve,750));
  }
  await stopLocalPreview();throw new Error('Local page startup timed out. Check the companion terminal.');
}
export async function stopLocalPreview(){const current=session;if(!current)return;current.controller.abort();current.ready=false;await api('/stop',{workspaceId:current.workspaceId},current.access);}
export async function forgetLocalPreview(){const current=session;session=null;if(!current)return;current.controller.abort();await api('/disconnect',{workspaceId:current.workspaceId},current.access);}
export async function readLocalSource(workspaceId:string,path:string){if(!session||session.workspaceId!==workspaceId)throw new Error('This workspace is not paired.');return (await api('/read',{workspaceId,path})).text as string;}
let writeTail:Promise<unknown>=Promise.resolve();
export function applyLocalSource(workspaceId:string,changes:SourceChange[],validate?: (signal:AbortSignal)=>Promise<void>){
  const current=session;
  if(!current||current.workspaceId!==workspaceId||!current.ready)return Promise.reject(new Error('Start this workspace’s local preview first.'));
  const result=writeTail.then(async()=>{
    current.controller.signal.throwIfAborted();
    const value=await api('/apply',{workspaceId,changes,approved:true},current.access);
    try{if(validate)await validate(AbortSignal.any([current.controller.signal,AbortSignal.timeout(20000)]));current.controller.signal.throwIfAborted();await api('/commit',{workspaceId,transaction:value.transaction},current.access);}
    catch(error){await api('/rollback',{workspaceId,transaction:value.transaction},current.access);throw error;}
  });writeTail=result.catch(()=>undefined);return result;
}
