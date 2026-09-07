import { verifyJsxSourceAnchor } from './jsx-source-anchors';
import { prepareBrowserRadiusPatch,applyBrowserSourcePatch } from './browser-source-patcher';
import { validatePreviewSource } from './preview-validation';
import type {TextEditTarget,TextEditorIO} from './mapped-text-editor';
import type {SourcePatch} from './source-patcher';

export type RadiusSnapshot={target:TextEditTarget;source:string;radius:string};
export type AppliedRadiusEdit={before:RadiusSnapshot;after:RadiusSnapshot;inverse:SourcePatch};
export async function loadMappedRadius(io:TextEditorIO,target:TextEditTarget,radius:string):Promise<RadiusSnapshot>{
  if(!radius||radius.length>120)throw new Error('Refresh the element to read its current corners.');
  const source=await io.read(target.workspaceId,target.anchor.file);
  await verifyJsxSourceAnchor(source,target.anchor);
  // Check supported source before exposing Apply. This prepares no write.
  await prepareBrowserRadiusPatch(source,target.anchor,0);
  return {target,source,radius};
}
export async function applyMappedRadius(io:TextEditorIO,before:RadiusSnapshot,pixels:number,signal:AbortSignal):Promise<AppliedRadiusEdit>{
  const patch=await prepareBrowserRadiusPatch(before.source,before.target.anchor,pixels);
  const anchor={...before.target.anchor,hash:patch.patch.resultHash,end:before.target.anchor.end+patch.output.length-before.source.length};
  await verifyJsxSourceAnchor(patch.output,anchor);signal.throwIfAborted();
  const after={target:{...before.target,anchor},source:patch.output,radius:`${pixels}px`};
  await io.apply(before.target.workspaceId,[{path:anchor.file,before:before.source,after:patch.output}],sessionSignal=>validatePreviewSource(before.target.workspaceId,before.target.frameId,{...after.target,styles:{borderRadius:after.radius}},AbortSignal.any([signal,sessionSignal])));
  return {before,after,inverse:patch.inversePatch};
}
export async function undoMappedRadius(io:TextEditorIO,edit:AppliedRadiusEdit,signal:AbortSignal){
  const {target}=edit.after,current=await io.read(target.workspaceId,target.anchor.file),output=await applyBrowserSourcePatch(current,edit.inverse);
  signal.throwIfAborted();
  await io.apply(target.workspaceId,[{path:target.anchor.file,before:current,after:output}],sessionSignal=>validatePreviewSource(target.workspaceId,target.frameId,{...edit.before.target,styles:{borderRadius:edit.before.radius}},AbortSignal.any([signal,sessionSignal])));
  return edit.before;
}
