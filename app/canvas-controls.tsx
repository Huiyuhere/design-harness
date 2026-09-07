"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from 'react-dom';
import { Check, Github, ShieldCheck, Sparkles } from "lucide-react";

export function IconControl({ label, explanation, children, onClick, active, disabled, className = "", floating = false }: {
  label: string; explanation: string; children?: ReactNode; onClick?: () => void; active?: boolean; disabled?: boolean; className?: string; floating?: boolean;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const show = () => { clearTimeout(leaveTimer.current); const rect = trigger.current?.getBoundingClientRect(); const boundary = trigger.current?.closest('[data-tooltip-boundary]')?.getBoundingClientRect(); if (floating && rect) setPosition({ left: Math.max(8, (boundary?.left ?? rect.left) - 222), top: Math.max(8, Math.min(innerHeight - 140, rect.top)) }); setVisible(true); };
  const leave = () => { if (floating) leaveTimer.current = setTimeout(() => setVisible(false), 150); else setVisible(false); };
  useEffect(() => () => clearTimeout(leaveTimer.current), []);
  useEffect(() => { if (!visible || !floating) return; const close = () => setVisible(false); window.addEventListener('scroll', close, true); window.addEventListener('resize', close); return () => { window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close); }; }, [visible, floating]);
  const hint = <div className={floating ? 'floating-control-hint' : 'control-hint'} role="tooltip" id={id} style={floating ? position : undefined} onMouseEnter={() => clearTimeout(leaveTimer.current)} onMouseLeave={leave}><strong>{label}</strong><span>{explanation}</span></div>;
  return <div className={`icon-control ${className}`} onMouseEnter={show} onMouseLeave={leave}>
    <button ref={trigger} type="button" aria-label={label} aria-describedby={visible ? id : undefined} aria-pressed={active} aria-disabled={disabled || undefined}
      className={active ? "active" : ""} onFocus={show} onBlur={() => setVisible(false)}
      onKeyDown={event => { if (event.key === "Escape") { setVisible(false); event.stopPropagation(); } }}
      onClick={() => { if (!disabled) onClick?.(); }}>
      {children}
    </button>
    {visible && (floating ? createPortal(hint, document.body) : hint)}
  </div>;
}

export function WorkspaceSetup({ repositoryReady, repositoryName, githubConnected, githubConfigured, aiConnected, loading, onImport, onKey }: {
  repositoryReady: boolean; repositoryName: string; githubConnected: boolean; githubConfigured: boolean; aiConnected: boolean; loading: boolean; onImport: () => void; onKey: () => void;
}) {
  return <section className="workspace-setup" aria-labelledby="workspace-setup-title">
    <div className="setup-symbol" aria-hidden="true"><Sparkles size={28} /></div>
    <h1 id="workspace-setup-title">Connect your workspace</h1>
    <p className="setup-subtitle">Two connections. Then your canvas.</p>
    <div className="setup-tiles">
      <article className={repositoryReady ? "connected" : ""}>
        <Github size={30} aria-hidden="true" /><h2>GitHub</h2>
        <p>{repositoryReady ? repositoryName : "Your repository"}</p>
        {repositoryReady ? <span className="connection-check"><Check size={15} />Ready</span>
          : loading ? <span className="connection-check" role="status">Checking…</span>
          : githubConnected ? <button onClick={onImport}>Choose repo</button>
          : <a href={githubConfigured ? "/api/github/install" : "/api/github/manifest"} aria-label="Connect GitHub">Connect</a>}
      </article>
      <article className={aiConnected ? "connected" : ""}>
        <Sparkles size={30} aria-hidden="true" /><h2>AI</h2><p>Your OpenAI key</p>
        {loading ? <span className="connection-check" role="status">Checking…</span> : aiConnected ? <button className="connection-check" onClick={onKey} aria-label="Manage connected AI key"><Check size={15} />Connected</button> : <button onClick={onKey}>Add key</button>}
      </article>
    </div>
    <p className="setup-approval"><ShieldCheck size={15} aria-hidden="true" />AI edits need your approval.</p>
    <details className="setup-privacy"><summary>Access & privacy</summary><ul>
      <li>Choose which repositories the GitHub App can access. No personal GitHub token.</li>
      <li>Imports are read-only. Publishing requires a separate approval.</li>
      <li>Your AI key is encrypted and kept out of project files. AI requests use your account’s credits.</li>
    </ul></details>
  </section>;
}
