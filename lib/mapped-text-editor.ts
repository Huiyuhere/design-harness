import { verifyJsxSourceAnchor } from './jsx-source-anchors';
import { prepareBrowserTextPatch, applyBrowserSourcePatch } from './browser-source-patcher';
import { validatePreviewSource } from './preview-validation';
import type { SourceAnchor } from './source-anchor';
import type { SourceChange } from './preview-drafts';
import type { SourcePatch } from './source-patcher';

export type TextEditTarget = {workspaceId:string;frameId:string;nodeId:string;generation:string;anchor:SourceAnchor;observedText?:string};
export type TextEditSnapshot = {target:TextEditTarget;source:string;text:string};
export type AppliedTextEdit = {before:TextEditSnapshot;after:TextEditSnapshot;inverse:SourcePatch};
export type TextEditorIO = {
  read(workspaceId:string,path:string):Promise<string>;
  apply(workspaceId:string,changes:SourceChange[],validate:(signal:AbortSignal)=>Promise<void>):Promise<void>;
};
export async function loadMappedText(io:TextEditorIO,target:TextEditTarget):Promise<TextEditSnapshot> {
  const source=await io.read(target.workspaceId,target.anchor.file),{textTarget}=await verifyJsxSourceAnchor(source,target.anchor);
  if(!textTarget)throw new Error('This text contains components or dynamic values. Use Open JSX for a reviewed code edit.');
  if(textTarget.renderedValue.length>2000)throw new Error('This text is too long for the inline editor. Use Open JSX.');
  if(target.observedText!==undefined&&target.observedText!==textTarget.renderedValue)throw new Error('The page text differs from this source. Refresh or use Open JSX to inspect dynamic behavior.');
  return {target,source,text:textTarget.renderedValue};
}
export async function applyMappedText(io:TextEditorIO,before:TextEditSnapshot,text:string,signal?:AbortSignal):Promise<AppliedTextEdit> {
  if(typeof text!=='string'||text.length>2000)throw new Error('Keep this text under 2,000 characters.');
  const {target,source}=before;
  const {textTarget}=await verifyJsxSourceAnchor(source,target.anchor);
  if(!textTarget)throw new Error('This source is not a single static text value.');
  const patch=await prepareBrowserTextPatch(source,textTarget.value,text,target.anchor.hash,textTarget);
  const anchor={...target.anchor,hash:patch.patch.resultHash,end:target.anchor.end+patch.output.length-source.length};
  await verifyJsxSourceAnchor(patch.output,anchor); signal?.throwIfAborted();
  await io.apply(target.workspaceId,[{path:anchor.file,before:source,after:patch.output}],sessionSignal=>validatePreviewSource(target.workspaceId,target.frameId,{...target,anchor,text},signal?AbortSignal.any([signal,sessionSignal]):sessionSignal));
  return {before,after:{target:{...target,anchor,observedText:text},source:patch.output,text},inverse:patch.inversePatch};
}
export async function undoMappedText(io:TextEditorIO,edit:AppliedTextEdit,signal?:AbortSignal) {
  const {target}=edit.after;
  const current=await io.read(target.workspaceId,target.anchor.file),output=await applyBrowserSourcePatch(current,edit.inverse);
  signal?.throwIfAborted();
  await io.apply(target.workspaceId,[{path:target.anchor.file,before:current,after:output}],sessionSignal=>validatePreviewSource(target.workspaceId,target.frameId,{...target,anchor:edit.before.target.anchor,text:edit.before.text},signal?AbortSignal.any([signal,sessionSignal]):sessionSignal));
  return edit.before;
}
