"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { AlertCircle, RotateCw } from 'lucide-react';
import { normalizeScrollSnapshot, previewFrameUrl, type ScrollSnapshot } from '../lib/frame-runtime';
import { readInspection, type InspectCommand, type PreviewInspection, type PreviewMode } from '../lib/preview-inspection';
import { connectPreviewValidation } from '../lib/preview-validation';

/** One actual application iframe; stored scroll changes never change its URL. */
type Props = {
  baseUrl: string; route: string; frameId: string; title: string; scroll?: ScrollSnapshot;
  style?: CSSProperties; onScroll: (snapshot: ScrollSnapshot) => void;
  mode?: PreviewMode; inspectCommand?: InspectCommand;
  workspaceId?: string;
  onInspection?: (inspection: PreviewInspection | null) => void;
};
export function PreviewFrame(props: Props) {
  const [attempt, setAttempt] = useState(0);
  const src = previewFrameUrl(props.baseUrl, props.route, props.frameId);
  return <LiveFrame key={`${src}:${attempt}`} {...props} onRetry={() => setAttempt(value => value + 1)} />;
}

function LiveFrame({ baseUrl, route, frameId, title, scroll, style, onScroll, onRetry, mode = 'prototype', inspectCommand, onInspection, workspaceId }: Props & { onRetry: () => void }) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ scroll, onScroll, mode, onInspection });
  const [status, setStatus] = useState('Loading page…');
  const [error, setError] = useState(false);
  const src = previewFrameUrl(baseUrl, route, frameId);
  const expectedOrigin = new URL(src).origin;
  useEffect(()=>{const source=iframe.current?.contentWindow;if(workspaceId&&source)return connectPreviewValidation(workspaceId,frameId,source,expectedOrigin);},[workspaceId,frameId,expectedOrigin]);
  useEffect(() => { latest.current = { scroll, onScroll, mode, onInspection }; }, [scroll, onScroll, mode, onInspection]);
  const initialize = () => iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:init', frameId, mode: latest.current.mode, scroll: normalizeScrollSnapshot(latest.current.scroll) }, expectedOrigin);
  useEffect(() => { iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:mode', frameId, mode }, expectedOrigin); }, [frameId, mode, expectedOrigin]);
  useEffect(() => { if (inspectCommand) iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:inspect', frameId, ...inspectCommand }, expectedOrigin); }, [frameId, expectedOrigin, inspectCommand]);
  useEffect(() => {
    let ready = false, failed = false;
    const timer = window.setTimeout(() => { if (!ready) setStatus('Waiting for preview connection…'); }, 15000);
    const timeout = window.setTimeout(() => { if (!ready) { failed = true; setError(true); setStatus('The page did not connect within 60 seconds. It may still be compiling, or its runtime may have failed.'); } }, 60000);
    const onMessage = (event: MessageEvent) => {
      // Origin alone is insufficient: another frame must not overwrite this frame.
      if (event.origin !== expectedOrigin || event.source !== iframe.current?.contentWindow || event.data?.frameId !== frameId) return;
      if (event.data.type === 'agent-harness:hello') { latest.current.onInspection?.(null); iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:init', frameId, mode: latest.current.mode, scroll: normalizeScrollSnapshot(latest.current.scroll) }, expectedOrigin); }
      if (event.data.type === 'agent-harness:ready') { ready = true; clearTimeout(timer); clearTimeout(timeout); if (!failed) setStatus(''); if (latest.current.onInspection) iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:inspect', frameId }, expectedOrigin); }
      if (event.data.type === 'agent-harness:inspection') { const inspection = readInspection(event.data.inspection); if (inspection) latest.current.onInspection?.(inspection); }
      if (event.data.type === 'agent-harness:scroll') latest.current.onScroll(normalizeScrollSnapshot(event.data.snapshot));
      if (event.data.type === 'agent-harness:runtime-error') { ready = true; failed = true; clearTimeout(timer); clearTimeout(timeout); setError(true); setStatus(typeof event.data.message === 'string' ? event.data.message.slice(0, 400) : 'Preview error'); }
    };
    window.addEventListener('message', onMessage);
    return () => { clearTimeout(timer); clearTimeout(timeout); window.removeEventListener('message', onMessage); };
  }, [src, expectedOrigin, frameId]);
  return <><iframe ref={iframe} title={title} data-live-frame-id={frameId} src={src} allow="cross-origin-isolated; loopback-network" style={style}
    onLoad={initialize} />
    {status && <div className={`frame-runtime-feedback ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{error ? <><div className="frame-error-title"><AlertCircle size={16} aria-hidden="true" /><strong>Preview needs attention</strong><button type="button" onClick={onRetry} aria-label={`Retry ${title} preview`}><RotateCw size={14} aria-hidden="true" />Retry</button></div><details><summary>Details</summary><p>{status}</p></details></> : status}</div>}</>;
}
