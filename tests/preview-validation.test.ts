import assert from 'node:assert/strict';
import test from 'node:test';
import {connectPreviewValidation,validatePreviewSource,sourceExpectationSchema} from '../lib/preview-validation';
const expected={nodeId:'n1',generation:'bb425bdd-3a2d-4bb7-8459-a86b7dffec2d',anchor:{v:1 as const,file:'App.tsx',hash:'a'.repeat(64),start:0,end:10,tag:'h1',line:1,column:0},text:'Updated'};
function fixture(){
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window'),bus=new EventTarget(),sent:Array<Record<string,unknown>>=[];
  Object.defineProperty(globalThis,'window',{value:bus,configurable:true});
  const source={postMessage:(data:Record<string,unknown>)=>sent.push(data)} as unknown as Window;
  const dispose=connectPreviewValidation('workspace','frame',source,'https://preview.example');
  const message=(data:Record<string,unknown>,sender=source,origin='https://preview.example')=>bus.dispatchEvent(Object.assign(new Event('message'),{data,source:sender,origin}));
  const restore=()=>{dispose();if(previous)Object.defineProperty(globalThis,'window',previous);else Reflect.deleteProperty(globalThis,'window');};
  return {sent,message,restore,source};
}
test('source validation rejects malformed targets and disconnected workspaces',async()=>{
  assert.equal(sourceExpectationSchema.safeParse({...expected,text:'x'.repeat(2001)}).success,false);
  await assert.rejects(validatePreviewSource('missing','missing',expected,new AbortController().signal),/Open this page/);
});
test('only the exact sender, origin, frame and request can complete an edit',async()=>{
  const f=fixture();try{let done=false;const pending=validatePreviewSource('workspace','frame',expected,new AbortController().signal).then(()=>{done=true;});
    const requestId=f.sent[0].requestId,payload={type:'agent-harness:source-validation',frameId:'frame',requestId,status:'matched'};
    f.message(payload,{} as Window);f.message(payload,f.source,'https://other.example');f.message({...payload,frameId:'other'});f.message({...payload,requestId:'old'});
    await Promise.resolve();assert.equal(done,false);f.message(payload);await pending;assert.equal(done,true);
  }finally{f.restore();}
});
test('cancellation stops a pending check and a runtime error fails closed',async()=>{
  const f=fixture();try{const controller=new AbortController(),pending=validatePreviewSource('workspace','frame',expected,controller.signal);const rejected=assert.rejects(pending,{name:'AbortError'});controller.abort();await rejected;assert.ok(f.sent.some(message=>message.type==='agent-harness:cancel-source-validation'));
    const next=validatePreviewSource('workspace','frame',expected,new AbortController().signal);const failed=assert.rejects(next,/runtime error/);f.message({type:'agent-harness:runtime-error',frameId:'frame'});await failed;
    await assert.rejects(validatePreviewSource('workspace','frame',expected,new AbortController().signal),/Reopen/);
  }finally{f.restore();}
});
test('closing a frame rejects its pending edit and removes the connection',async()=>{
  const f=fixture();const pending=validatePreviewSource('workspace','frame',expected,new AbortController().signal);const rejected=assert.rejects(pending,/frame closed/);f.restore();await rejected;
  await assert.rejects(validatePreviewSource('workspace','frame',expected,new AbortController().signal),/Open this page/);
});
