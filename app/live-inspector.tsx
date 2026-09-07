"use client";

import { Code2, Copy, Layers3, MousePointer2, RefreshCw, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import { IconControl } from './canvas-controls';
import type { PreviewInspection } from '../lib/preview-inspection';
import type { SourceAnchor } from '../lib/source-anchor';
import { MappedTextEditor,type TextEditNotice } from './mapped-text-editor';
import type { TextEditorIO } from '../lib/mapped-text-editor';

export function LiveInspector({ tab, inspection, available, onRefresh, onSelect, onSource, onDiscuss, workspaceId,frameId,editorIO,onTextApplied }: {
  tab: 'design' | 'layers'; inspection: PreviewInspection | null; available: boolean;
  onRefresh(): void; onSelect(id: string, generation: string): void; onSource(anchor?: SourceAnchor): void; onDiscuss(): void;
  workspaceId?:string;frameId?:string;editorIO?:TextEditorIO;onTextApplied?(notice:TextEditNotice):void;
}) {
  const [copyStatus, setCopyStatus] = useState('');
  const selected = inspection?.selection;
  const pairs = selected ? [
    ['Width', `${Math.round(selected.width * 10) / 10}px`], ['Height', `${Math.round(selected.height * 10) / 10}px`],
    ['Font', selected.styles.fontFamily], ['Size', selected.styles.fontSize], ['Color', selected.styles.color], ['Radius', selected.styles.borderRadius],
    ['Weight', selected.styles.fontWeight], ['Line', selected.styles.lineHeight], ['Fill', selected.styles.backgroundColor],
    ['Layout', selected.styles.display], ['Position', selected.styles.position],
    ['Gap', selected.styles.gap], ['Padding', selected.styles.padding], ['Margin', selected.styles.margin],
  ] : [];
  return <div className="live-inspector inspector-body" data-tooltip-boundary>
    <header className="live-inspector-tools"><span><Layers3 size={15} aria-hidden="true" />Live DOM</span>
      <IconControl floating label="Refresh elements" explanation="Read the current page again. Layers are a bounded snapshot, not a saved design tree." onClick={onRefresh} disabled={!available}><RefreshCw size={16} aria-hidden="true" /></IconControl>
    </header>
    {!available ? <div className="live-inspector-empty"><MousePointer2 size={24} aria-hidden="true" /><p>Open this page to inspect it.</p></div>
      : tab === 'layers' ? <><nav aria-label="Live page elements" className="live-dom-layers">{inspection?.layers.map(node => <button key={node.id} type="button" aria-pressed={selected?.id === node.id} className={selected?.id === node.id ? 'active' : ''} style={{ paddingLeft: 10 + Math.min(node.depth, 8) * 12 }} onClick={() => onSelect(node.id, inspection.generation)} title={`${node.tag} · ${node.label}`}><Code2 size={13} aria-hidden="true" /><span><small>{node.tag}</small>{node.label}</span></button>)}</nav>{!inspection && <p>Select an element or refresh.</p>}{inspection?.truncated && <p className="inspection-note">First 200 elements. You can select other visible elements directly.</p>}</>
      : selected ? <><div className="live-selection-title"><code>&lt;{selected.tag}&gt;</code><strong>{selected.label}</strong></div>
        {selected.text && <section className="live-inspector-copy"><header><span>Text</span><IconControl floating label="Copy element text" explanation="Copy the selected element’s visible text, not its source code." onClick={() => { void navigator.clipboard.writeText(selected.text).then(() => setCopyStatus('Copied'), () => setCopyStatus('Copy unavailable')); }}><Copy size={15} aria-hidden="true" /></IconControl></header><pre>{selected.text}</pre><span role="status">{copyStatus}</span></section>}
        {selected.source&&workspaceId&&frameId&&inspection&&<MappedTextEditor key={`${workspaceId}:${frameId}:${inspection.generation}:${selected.id}`} target={{workspaceId,frameId,nodeId:selected.id,generation:inspection.generation,anchor:selected.source,observedText:selected.text}} io={editorIO} onApplied={onTextApplied}/>}
        <dl className="live-style-values">{pairs.slice(0, 6).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
        <details className="live-more-styles"><summary>More styles</summary><dl className="live-style-values">{pairs.slice(6).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></details>
        <div className="live-inspector-tools"><button className="live-discuss" onClick={onDiscuss}>Discuss element</button>{selected.source && <IconControl floating label="Open JSX" explanation="Check the source hash and open this element’s actual component. This does not apply an edit." onClick={() => onSource(selected.source!)}><Code2 size={17} aria-hidden="true" /></IconControl>}</div>
      </> : <div className="live-inspector-empty"><MousePointer2 size={24} aria-hidden="true" /><p>Select an element in Edit mode.</p></div>}
    <details className="inspection-source-note"><summary><ShieldCheck size={14} aria-hidden="true" />{selected?.source?'Editing limits':'Inspect only'}</summary><p>{selected?.source ? 'Static text can be edited after a source check. Visual style editing is not supported yet. Open JSX opens the actual component.' : 'These are real DOM values. This element has no supported source marker, so visual edits are disabled. The route file may not be the selected component.'}</p><button onClick={() => onSource()} disabled={!available}>Open route source</button></details>
  </div>;
}
