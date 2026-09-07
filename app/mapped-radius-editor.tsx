"use client";
import {useEffect,useId,useRef,useState} from 'react';
import {Radius,Undo2} from 'lucide-react';
import {IconControl} from './canvas-controls';
import {loadMappedRadius,applyMappedRadius,undoMappedRadius,type RadiusSnapshot,type AppliedRadiusEdit} from '../lib/mapped-radius-editor';
import type {TextEditTarget,TextEditorIO} from '../lib/mapped-text-editor';
import type {TextEditNotice} from './mapped-text-editor';

const runtimeIO:TextEditorIO={
  async read(workspaceId,path){return (await import('../lib/live-preview-client')).readLiveSource(workspaceId,path);},
  async apply(workspaceId,changes,validate){return (await import('../lib/live-preview-client')).applyLiveSourceChanges(workspaceId,changes,validate);},
};
export function MappedRadiusEditor({target,radius,io=runtimeIO,onApplied}:{target:TextEditTarget;radius:string;io?:TextEditorIO;onApplied?(notice:TextEditNotice):void}){
  const id=useId(),mounted=useRef(true),controller=useRef<AbortController|null>(null);
  const [snapshot,setSnapshot]=useState<RadiusSnapshot|null>(null),[value,setValue]=useState('24'),[approved,setApproved]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState(''),[last,setLast]=useState<AppliedRadiusEdit|null>(null);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const load=async()=>{setBusy(true);setError('');setMessage('Checking source…');try{const next=await loadMappedRadius(io,target,radius);if(mounted.current){setSnapshot(next);setValue('24');setApproved(false);setMessage('');setLast(null);}}catch(error){if(mounted.current){setError((error as Error).message);setMessage('');}}finally{if(mounted.current)setBusy(false);}};
  const run=async(undo=false)=>{
    if(!snapshot||busy||(!undo&&!approved))return;const request=new AbortController();controller.current=request;setBusy(true);setError('');setMessage(undo?'Restoring corners…':'Checking the live corners…');
    try{
      if(undo&&last){const next=await undoMappedRadius(io,last,request.signal);onApplied?.({file:next.target.anchor.file,before:last.after.radius,after:next.radius,undo:true,property:'borderRadius'});if(mounted.current){setSnapshot(next);setLast(null);setMessage('Corners restored.');}}
      else{if(!value.trim())throw new Error('Enter a radius in px.');const edit=await applyMappedRadius(io,snapshot,Number(value),request.signal);onApplied?.({file:edit.after.target.anchor.file,before:edit.before.radius,after:edit.after.radius,undo:false,property:'borderRadius'});if(mounted.current){setSnapshot(edit.after);setLast(edit);setMessage('Radius verified on this page.');}}
    }catch(error){if(mounted.current){setMessage('');setError((error as Error).name==='AbortError'?'Cancelled. Previous source restored.':(error as Error).message);}}
    finally{if(controller.current===request)controller.current=null;if(mounted.current)setBusy(false);}
  };
  return <section className="mapped-text-editor mapped-radius-editor" aria-label="Edit selected corners">
    {!snapshot?<IconControl floating label="Edit corners" explanation="Change this element's inline radius after an explicit all-sizes choice. CSS conflicts block the edit." disabled={busy} onClick={()=>void load()}><Radius size={16} aria-hidden="true"/></IconControl>:<>
      <label htmlFor={id}>Corner radius · px</label><input id={id} type="number" min="0" max="512" step="0.5" value={value} disabled={busy} onChange={event=>setValue(event.target.value)}/>
      <label className="radius-scope"><input type="checkbox" checked={approved} disabled={busy} onChange={event=>setApproved(event.target.checked)}/><span>Override this element at all sizes</span></label>
      <p className="mapped-scope">Shared components change on other pages too.</p>
      <div className="mapped-text-actions"><button className="primary" disabled={busy||!approved} onClick={()=>void run()}>Apply radius</button>{busy?<button onClick={()=>{controller.current?.abort();setMessage('Restoring…');}}>Stop radius edit</button>:<button onClick={()=>{setSnapshot(null);setLast(null);setMessage('');setError('');}}>Close corners</button>}{last&&<IconControl floating label="Undo radius edit" explanation="Restore exact source and check this page's previous corners." disabled={busy} onClick={()=>void run(true)}><Undo2 size={16} aria-hidden="true"/></IconControl>}</div>
      <details><summary>Source & scope</summary><p>{snapshot.target.anchor.file}:{snapshot.target.anchor.line}</p><p>Writes inline JSX, not CSS rules. Conflicting corner rules and dynamic styles require a code review. Undo lasts while this editor stays open; this is not production pixel verification.</p></details>
    </>}{message&&<p role="status">{message}</p>}{error&&<p role="alert">{error}</p>}
  </section>;
}
