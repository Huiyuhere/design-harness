import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WebContainer } from '@webcontainer/api';
import { PreviewSession } from '../../lib/preview-session';
import { PreviewFrame } from '../../app/preview-frame';
import { LiveInspector } from '../../app/live-inspector';
import { buildPreviewBridge } from '../../lib/preview-bridge';
import { loadPreviewSourceTool } from '../../lib/live-preview-client';
import { browserPreviewDrafts } from '../../lib/preview-drafts';
import type { PreviewInspection } from '../../lib/preview-inspection';
import type { SourceAnchor } from '../../lib/source-anchor';
import { verifyJsxSourceAnchor } from '../../lib/jsx-source-anchors';
import { prepareBrowserTextPatch, applyBrowserSourcePatch } from '../../lib/browser-source-patcher';
import type {TextEditorIO} from '../../lib/mapped-text-editor';
import '../../app/globals.css';

const id='source-anchor-regression';
const action=`import React,{useState} from 'react';
export default function Action(){const [count,setCount]=useState(0);React.useLayoutEffect(()=>{if(document.querySelector('#action')?.textContent==='Trigger render error')throw Error('Intentional source render failure');});return <section><h1>Start</h1><button id="action" onClick={()=>setCount(count+1)}>Start</button><output>{count}</output><p id="formatted">
  Hello
  world
</p></section>}`;
const pkg=JSON.stringify({name:id,private:true,type:'module',scripts:{predev:'node -e "require(\'fs\').writeFileSync(\'predev.txt\',\'preserved\')"',dev:'vite'},dependencies:{vite:'6.4.1','@vitejs/plugin-react':'4.7.0',react:'19.2.6','react-dom':'19.2.6'}});
let runtime:WebContainer|undefined, snapshot:PreviewInspection|null=null;
const events:unknown[]=[];
const session=new PreviewSession({boot:async()=>runtime??=await WebContainer.boot({coep:'credentialless'}),sourceTool:loadPreviewSourceTool,bridge:()=>buildPreviewBridge(location.origin),drafts:browserPreviewDrafts,download:async()=>({
  'package.json':{file:{contents:pkg}},
  'vite.config.mjs':{file:{contents:`import react from '@vitejs/plugin-react';import {fileURLToPath} from 'node:url';export default {root:'src',plugins:[react()],resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},server:{host:'0.0.0.0'},define:{__CONFIG_PRESERVED__:'true'}}`}},
  src:{directory:{
    'index.html':{file:{contents:'<!doctype html><html><body><div id="root"></div><script type="module" src="/main.tsx"></script></body></html>'}},
    'main.tsx':{file:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import Action from '@/components/Action';document.body.dataset.config=String(__CONFIG_PRESERVED__);createRoot(document.getElementById('root')!).render(<Action/>);`}},
    components:{directory:{'Action.tsx':{file:{contents:action}}}},
  }},
})});
const editorIO:TextEditorIO={read:(workspaceId,path)=>session.read(workspaceId,path),apply:(workspaceId,changes,validate)=>session.apply(workspaceId,changes,validate)};
const api={
  events, snapshot:()=>snapshot,
  read:(path:string)=>session.read(id,path),
  diagnostics:()=>session.diagnostics(id),
  async externalChange(text:string){const path='src/components/Action.tsx';await session.apply(id,[{path,before:await session.read(id,path),after:text}]);},
  async roundtrip(anchor:SourceAnchor){
    const source=await session.read(id,anchor.file),{textTarget}=await verifyJsxSourceAnchor(source,anchor);
    if(!textTarget)throw Error('Dynamic copy is not directly editable.');
    const patch=await prepareBrowserTextPatch(source,textTarget.value,'Begin\n  now',anchor.hash,textTarget);
    await session.apply(id,[{path:anchor.file,before:source,after:patch.output}]);
    return {patch,source};
  },
  async inverse(path:string,patch:Parameters<typeof applyBrowserSourcePatch>[1]){
    const source=await session.read(id,path),output=await applyBrowserSourcePatch(source,patch);
    await session.apply(id,[{path,before:source,after:output}]);return output;
  },
  verify:(source:string,anchor:SourceAnchor)=>verifyJsxSourceAnchor(source,anchor),
  async stop(){await session.stop();runtime?.teardown();},
};
declare global {interface Window { anchorTest:typeof api }}
window.anchorTest=api;
function Fixture(){
  const [url,setUrl]=useState(''),[status,setStatus]=useState('Ready'),[inspection,setInspection]=useState<PreviewInspection|null>(null),[mode,setMode]=useState<'edit'|'prototype'>('edit'),[sequence,setSequence]=useState(0),[opened,setOpened]=useState(''),[error,setError]=useState('');
  const open=async(anchor?:SourceAnchor)=>{if(!anchor)return;try{const text=await session.read(id,anchor.file);await verifyJsxSourceAnchor(text,anchor);setOpened(`${anchor.file}:${anchor.line}\n${text.slice(anchor.start,anchor.end)}`);setError('');}catch(error){setError(String(error));}};
  return <main style={{padding:24,fontFamily:'system-ui'}}><h1>Live JSX source audit</h1><p>This is a synthetic Vite test, not Finite import acceptance.</p>
    <button onClick={()=>void session.start({workspaceId:id,repositoryUrl:'https://github.com/example/source-anchor-regression',ref:'b'.repeat(40),trusted:true,onEvent:event=>{events.push(event);setStatus(event.message);if(event.url)setUrl(event.url);}}).catch(error=>setError(String(error)))}>Start browser runtime</button>
    <p role="status">{status}</p><button onClick={()=>setMode(mode==='edit'?'prototype':'edit')}>{mode==='edit'?'Interact':'Select'}</button>
    <div style={{display:'grid',gridTemplateColumns:'1fr 350px',gap:20}}>
      <div style={{position:'relative'}}>{url&&<PreviewFrame workspaceId={id} baseUrl={url} route="/" frameId="action" title="Mapped Vite preview" mode={mode} onScroll={()=>{}} inspectCommand={{sequence}} onInspection={value=>{snapshot=value;setInspection(value);}} style={{width:'100%',height:500}}/>}</div>
      <LiveInspector workspaceId={id} frameId="action" editorIO={editorIO} onTextApplied={notice=>events.push({textEdit:notice})} tab="design" available={Boolean(url)} inspection={inspection} onRefresh={()=>setSequence(sequence+1)} onSelect={()=>{}} onSource={anchor=>void open(anchor)} onDiscuss={()=>{}}/>
    </div><pre id="opened">{opened}</pre><p role="alert">{error}</p>
    {url&&new URLSearchParams(location.search).has('editor')&&<div style={{position:'relative'}}><PreviewFrame workspaceId={id} baseUrl={url} route="/" frameId="comparison" title="Shared mobile component" onScroll={()=>{}} style={{width:390,height:300}}/></div>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
