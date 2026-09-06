"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { normalizeScrollSnapshot, previewFrameUrl, type ScrollSnapshot } from '../lib/frame-runtime';

/** One actual application iframe; stored scroll changes never change its URL. */
export function PreviewFrame({ baseUrl, route, frameId, title, scroll, style, onScroll }: {
  baseUrl: string; route: string; frameId: string; title: string; scroll?: ScrollSnapshot;
  style?: CSSProperties; onScroll: (snapshot: ScrollSnapshot) => void;
}) {
  const iframe = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ scroll, onScroll });
  const [status, setStatus] = useState('Loading page…');
  const [error, setError] = useState(false);
  const src = previewFrameUrl(baseUrl, route, frameId);
  const expectedOrigin = new URL(src).origin;
  useEffect(() => { latest.current = { scroll, onScroll }; }, [scroll, onScroll]);
  const initialize = () => iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:init', frameId, scroll: normalizeScrollSnapshot(latest.current.scroll) }, expectedOrigin);
  useEffect(() => {
    let ready = false;
    const timer = window.setTimeout(() => { if (!ready) setStatus('Waiting for preview connection…'); }, 15000);
    const onMessage = (event: MessageEvent) => {
      // Origin alone is insufficient: another frame must not overwrite this frame.
      if (event.origin !== expectedOrigin || event.source !== iframe.current?.contentWindow || event.data?.frameId !== frameId) return;
      if (event.data.type === 'agent-harness:hello') iframe.current?.contentWindow?.postMessage({ type: 'agent-harness:init', frameId, scroll: normalizeScrollSnapshot(latest.current.scroll) }, expectedOrigin);
      if (event.data.type === 'agent-harness:ready') { ready = true; clearTimeout(timer); setStatus(''); }
      if (event.data.type === 'agent-harness:scroll') latest.current.onScroll(normalizeScrollSnapshot(event.data.snapshot));
      if (event.data.type === 'agent-harness:runtime-error') { ready = true; clearTimeout(timer); setError(true); setStatus(typeof event.data.message === 'string' ? event.data.message.slice(0, 400) : 'Preview error'); }
    };
    window.addEventListener('message', onMessage);
    return () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
  }, [src, expectedOrigin, frameId]);
  return <><iframe ref={iframe} title={title} data-live-frame-id={frameId} src={src} allow="cross-origin-isolated" style={style}
    onLoad={initialize} />
    {status && <div className={`frame-runtime-feedback ${error ? 'error' : ''}`} role={error ? 'alert' : 'status'}>{status}</div>}</>;
}
