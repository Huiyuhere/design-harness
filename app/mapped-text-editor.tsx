"use client";
import { useEffect,useId,useRef,useState } from 'react';
import { Pencil,Undo2 } from 'lucide-react';
import { IconControl } from './canvas-controls';
import { applyMappedText,loadMappedText,undoMappedText,type AppliedTextEdit,type TextEditSnapshot,type TextEditTarget,type TextEditorIO } from '../lib/mapped-text-editor';

const runtimeIO:TextEditorIO={
  async read(workspaceId,path){return (await import('../lib/live-preview-client')).readLiveSource(workspaceId,path);},
  async apply(workspaceId,changes,validate){return (await import('../lib/live-preview-client')).applyLiveSourceChanges(workspaceId,changes,validate);},
};
export type TextEditNotice={file:string;before:string;after:string;undo:boolean};
export function MappedTextEditor({target,io=runtimeIO,onApplied}:{target:TextEditTarget;io?:TextEditorIO;onApplied?(notice:TextEditNotice):void}) {
  const fieldId=useId();
  const [snapshot,setSnapshot]=useState<TextEditSnapshot|null>(null),[draft,setDraft]=useState(''),[last,setLast]=useState<AppliedTextEdit|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('');
  const mounted=useRef(true),controller=useRef<AbortController|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=async()=>{setBusy(true);setError('');setMessage('Checking source…');try{const value=await loadMappedText(io,target);if(mounted.current){setSnapshot(value);setDraft(value.text);setMessage('');setLast(null);}}catch(error){if(mounted.current){setError((error as Error).message);setMessage('');}}finally{if(mounted.current)setBusy(false);}};
  const run=async(undo=false)=>{
    if(!snapshot||busy)return;const request=new AbortController();controller.current=request;setBusy(true);setError('');setMessage(undo?'Restoring text…':'Checking the live page…');
    try{
      if(undo&&last){const value=await undoMappedText(io,last,request.signal);onApplied?.({file:value.target.anchor.file,before:last.after.text,after:value.text,undo:true});if(mounted.current){setSnapshot(value);setDraft(value.text);setLast(null);setMessage('Undo verified.');}}
      else{const edit=await applyMappedText(io,snapshot,draft,request.signal);onApplied?.({file:edit.after.target.anchor.file,before:edit.before.text,after:edit.after.text,undo:false});if(mounted.current){setSnapshot(edit.after);setDraft(edit.after.text);setLast(edit);setMessage('Text verified on this page.');}}
    }catch(error){if(mounted.current){setMessage('');setError((error as Error).name==='AbortError'?'Cancelled. Previous source restored.':(error as Error).message);}}
    finally{if(controller.current===request)controller.current=null;if(mounted.current)setBusy(false);}
  };
  return <section className="mapped-text-editor" aria-label="Edit selected text">
    {!snapshot?<IconControl floating label="Edit text" explanation="Edit this exact JSX text. Apply checks the live page; unsupported or stale source is rejected." onClick={()=>void load()} disabled={busy}><Pencil size={16} aria-hidden="true"/></IconControl>:<>
      <label htmlFor={fieldId}>Edit text</label><p className="mapped-scope">Other pages may use this component.</p><textarea id={fieldId} aria-label="Selected text" maxLength={2000} value={draft} disabled={busy} onChange={event=>setDraft(event.target.value)}/>
      <div className="mapped-text-actions"><button className="primary" disabled={busy||draft===snapshot.text} onClick={()=>void run()}>Apply</button>{busy?<button onClick={()=>{controller.current?.abort();setMessage('Restoring…');}}>Stop</button>:<button onClick={()=>{setSnapshot(null);setMessage('');setError('');setLast(null);}}>Close</button>}{last&&<IconControl floating label="Undo text edit" explanation="Restore the exact previous source and check this page again. A newer source change blocks undo." disabled={busy} onClick={()=>void run(true)}><Undo2 size={16} aria-hidden="true"/></IconControl>}</div>
      <details><summary>Source & scope</summary><p>{snapshot.target.anchor.file}:{snapshot.target.anchor.line}</p><p>Line breaks follow the existing CSS. This checks text, not production pixels. Undo lasts while this editor stays open.</p></details>
    </>}
    {message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
