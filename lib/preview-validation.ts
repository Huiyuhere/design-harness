import { z } from 'zod';
import { sourceAnchorSchema } from './source-anchor';

export const sourceExpectationSchema = z.object({
  nodeId:z.string().regex(/^n[1-9][0-9]{0,8}$/), generation:z.string().uuid(),
  anchor:sourceAnchorSchema, text:z.string().max(2000).optional(),
  styles:z.object({borderRadius:z.string().min(1).max(120)}).strict().optional(),
}).refine(value=>value.text!==undefined||value.styles!==undefined,'A render expectation is required.');
export type SourceExpectation = z.infer<typeof sourceExpectationSchema>;
type ValidationPort = { validate(expected:SourceExpectation,signal:AbortSignal):Promise<void>; dispose():void };
const ports = new Map<string,ValidationPort>();
const key=(workspaceId:string,frameId:string)=>JSON.stringify([workspaceId,frameId]);

/** Tied to one actual iframe window, not just its URL or a caller-provided ID. */
export function connectPreviewValidation(workspaceId:string,frameId:string,source:Window,origin:string) {
  const id=key(workspaceId,frameId); ports.get(id)?.dispose();
  let pending:{requestId:string;finish(error?:Error):void}|null=null,disposed=false,failed=false;
  const send=(data:Record<string,unknown>)=>source.postMessage({...data,frameId},origin);
  const message=(event:MessageEvent)=>{
    if(event.source!==source||event.origin!==origin||event.data?.frameId!==frameId)return;
    if(event.data.type==='agent-harness:runtime-error'){failed=true;pending?.finish(new Error('The page reported a runtime error. Previous source was restored; retry the preview.'));}
    if(event.data.type==='agent-harness:hello'&&pending)pending.finish(new Error('The preview reloaded during the edit. Previous source was restored.'));
    if(event.data.type!=='agent-harness:source-validation'||event.data.requestId!==pending?.requestId)return;
    if(event.data.status==='matched')pending?.finish();
    else if(event.data.status==='error')pending?.finish(new Error('The selected element could not be verified. Previous source was restored.'));
  };
  window.addEventListener('message',message);
  const port:ValidationPort={
    async validate(untrusted,signal){
      const expected=sourceExpectationSchema.parse(untrusted);
      if(disposed||failed)throw new Error('Reopen the live preview before editing.');
      if(pending)throw new Error('Wait for the current element check to finish.');
      if(signal.aborted)throw new DOMException('Edit cancelled.','AbortError');
      return new Promise<void>((resolve,reject)=>{
        const requestId=crypto.randomUUID();
        const abort=()=>finish(new DOMException('Edit cancelled.','AbortError'));
        const timer=setTimeout(()=>finish(new Error('The page did not show the expected change in time. Previous source was restored.')),15_000);
        const finish=(error?:Error)=>{if(pending?.requestId!==requestId)return;clearTimeout(timer);signal.removeEventListener('abort',abort);pending=null;send({type:'agent-harness:cancel-source-validation',requestId});if(error)reject(error);else resolve();};
        pending={requestId,finish};signal.addEventListener('abort',abort,{once:true});
        send({type:'agent-harness:validate-source',requestId,expected});
      });
    },
    dispose(){disposed=true;pending?.finish(new Error('The live frame closed during the edit. Previous source was restored.'));window.removeEventListener('message',message);if(ports.get(id)===port)ports.delete(id);},
  };
  ports.set(id,port);return ()=>port.dispose();
}

export function validatePreviewSource(workspaceId:string,frameId:string,expected:SourceExpectation,signal:AbortSignal) {
  const port=ports.get(key(workspaceId,frameId));
  if(!port)return Promise.reject(new Error('Open this page live before applying the edit.'));
  return port.validate(expected,signal);
}
