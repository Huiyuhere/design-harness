"use client";

import {
  AlignCenter, AlignLeft, AlignRight, ArrowRight, ArrowUp, Bold, Bot, Check,
  ChevronDown, ChevronRight, CircleStop, Code2, Copy, Eye, GitBranch, Grid2X2,
  Italic, Layers3, Link2, Maximize2, MousePointer2,
  PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, Palette, Plus,
  Redo2, Search, Settings2, Sparkles, Undo2, ZoomIn, ZoomOut,
  Monitor, Tablet, Smartphone, Pin, Play, RefreshCw, ShieldCheck, AlertTriangle,
} from "lucide-react";
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useRef, useState } from "react";
import { parse } from "@babel/parser";
import { cloneRouteDesign, createRouteDesign, cssSize, CssUnit, NODE_META, normalizeRouteDesign, RouteDesignData, TextAlign, TextNodeKey, TEXT_NODE_KEYS } from "../lib/design-hierarchy";
import { FlowGap, flowGapPrompt, recordFlowGap, resolveFlowGap } from "../lib/flow-gaps";
import { BrandDocument, DocumentProposal, sha256 } from "../lib/brand-documents";
import { ACTIONS_LIMITATIONS, ValidationStatus } from "../lib/visual-validation";
import { chooseLiveFrameIds, EMPTY_SCROLL, PreviewRepresentation, RESPONSIVE_PROFILES, ResponsiveProfile, ScrollSnapshot, VerificationState, verificationLabel } from "../lib/frame-runtime";
import type { LivePreviewEvent } from "../lib/live-preview-client";

type CanvasMode = "edit" | "prototype" | "graph";
type InspectorTab = "design" | "layers" | "code" | "changes";
type FrameSpec = { id: string; sourceRouteId?: string; route: string; name: string; state: string; profile?: ResponsiveProfile; viewportWidth?: number; viewportHeight?: number; sourceFile?: string; scroll?: ScrollSnapshot; verification?: VerificationState; pinned?: boolean; x: number; y: number; width: number; height: number; accent: string; updatedAt: string };
type WorkspaceSpec = { id: string; name: string; repository: string; repositoryUrl?: string; baseSha: string; baseRef?: string; updatedAt: string; frames: FrameSpec[]; designs: Record<string, RouteDesignData>; connections: Record<string, Partial<Record<TextNodeKey, string>>>; gaps: FlowGap[]; brand: { colors: string[]; fonts: string[]; sourceFiles: string[]; documents?: BrandDocument[] } };
type EditTransaction = { id: string; workspaceId: string; frameId: string; timestamp: string; date: string; target: string; property: string; before: string; after: string; status: "validated" | "pending" };
type ApiKeyStatus = { loading: boolean; connected: boolean; masked?: string; models: string[]; validatedAt?: string };
type AgentReceipt = { selected?: { frames?: string[]; files?: string[] }; documents?: unknown[]; approvedMemories?: unknown[]; openFlowGaps?: unknown[]; attachedGapId?: string | null };
const INTERACTION_NODES: TextNodeKey[] = ["navProduct", "navCompany", "navDocs", "navAction", "primaryAction", "secondaryAction"];

const now = () => new Date().toISOString();
const INITIAL_STAMP = "2026-08-29T01:00:00.000Z";
const timeLabel = (value: string) => new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
const dateLabel = (value: string) => new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
const DEFAULT_BRAND = { colors: ["#202225", "#315EFB", "#FF6B47", "#F7F7F4"], fonts: ["Inter", "Geist", "IBM Plex Sans"], sourceFiles: ["styles/tokens.css", "app/globals.css"], documents: [] as BrandDocument[] };
const baseDesign = (headline: string, supporting: string) => createRouteDesign(headline, supporting);
const routeDesign = (headline: string, supporting: string, content: Partial<RouteDesignData["content"]> = {}, centered = false) => { const design = createRouteDesign(headline, supporting); design.content = { ...design.content, ...content }; if (centered) { design.styles.headline.align = "center"; design.styles.supporting.align = "center"; design.styles.eyebrow.align = "center"; } return design; };
const PROFILE_ICONS = { desktop: Monitor, tablet: Tablet, mobile: Smartphone } as const;
const frameRouteIdentity = (frame: FrameSpec) => frame.sourceRouteId ?? frame.id;
const withFrameDefaults = (frame: FrameSpec): FrameSpec => ({ ...frame, sourceRouteId: frame.sourceRouteId ?? frame.id, profile: frame.profile ?? "desktop", viewportWidth: frame.viewportWidth ?? RESPONSIVE_PROFILES.desktop.width, viewportHeight: frame.viewportHeight ?? RESPONSIVE_PROFILES.desktop.height, scroll: frame.scroll ?? EMPTY_SCROLL, verification: frame.verification ?? "not_verified" });
const initialFrames: FrameSpec[] = [
  { id: "home", route: "/", name: "Home", state: "Default", x: 80, y: 80, width: 430, height: 300, accent: "#ff6b47", updatedAt: INITIAL_STAMP },
  { id: "pricing", route: "/pricing", name: "Pricing", state: "Default", x: 570, y: 80, width: 430, height: 300, accent: "#7a64ff", updatedAt: INITIAL_STAMP },
  { id: "welcome", route: "/welcome", name: "Welcome", state: "Success", x: 80, y: 455, width: 430, height: 300, accent: "#16a978", updatedAt: INITIAL_STAMP },
  { id: "settings", route: "/settings", name: "Settings", state: "Account", x: 570, y: 455, width: 430, height: 300, accent: "#3478f6", updatedAt: INITIAL_STAMP },
];
const firstWorkspace: WorkspaceSpec = {
  id: "northstar", name: "Northstar website", repository: "Huiyuhere / northstar-web", baseSha: "8f31ae", updatedAt: INITIAL_STAMP, frames: initialFrames,
  brand: DEFAULT_BRAND,
  connections: { home: { primaryAction: "pricing" }, pricing: { primaryAction: "welcome" }, welcome: { primaryAction: "home" }, settings: { primaryAction: "home" } }, gaps: [],
  designs: {
    home: routeDesign("From interface idea\nto working React.", "Select real DOM layers, refine the layout, and commit source-ready changes."),
    pricing: routeDesign("Choose the workspace\nthat fits your team.", "Simple plans for teams designing in production code.", { eyebrow: "SIMPLE PRICING", primaryAction: "Studio" }),
    welcome: routeDesign("Your routes are on the canvas.", "Follow an interaction to the next route without losing this frame.", { eyebrow: "WORKSPACE READY", primaryAction: "Go to home" }, true),
    settings: routeDesign("Brand foundations", "Typography and colors inherited from this workspace only.", { eyebrow: "PROJECT SETTINGS", primaryAction: "Save and return home" }),
  },
};
const MODE_COPY = {
  edit: { title: "Edit page", body: "Select real elements. Text and inspector changes update only this route.", icon: MousePointer2 },
  prototype: { title: "Preview flow", body: "Clickable hotspots show their destination. Click one to move to the linked frame.", icon: Link2 },
  graph: { title: "Map relationships", body: "Review the route graph and the states connected by real interactions.", icon: GitBranch },
};

function HarnessMark({ compact = false }: { compact?: boolean }) {
  return <div className={compact ? "mark compact" : "mark"} aria-hidden="true"><span /><span /><span /></div>;
}

function FramePreview({ frame, design, mode, active, selectedNode, targets, gapCount, representation, liveBaseUrl, onSelect, onNavigate, onMissing, onInlineText, onFocus, onPin }: {
  frame: FrameSpec; design: RouteDesignData; mode: CanvasMode; active: boolean; selectedNode: TextNodeKey; targets: Partial<Record<TextNodeKey, FrameSpec>>; gapCount: number; representation: PreviewRepresentation; liveBaseUrl: string | null; onSelect: (node: TextNodeKey) => void; onNavigate: (target: string) => void; onMissing: (node: TextNodeKey) => void; onInlineText: (node: TextNodeKey, text: string) => void; onFocus: () => void; onPin: () => void;
}) {
  const choose = (event: React.MouseEvent, node: TextNodeKey) => { if (mode === "edit") { event.stopPropagation(); onSelect(node); } };
  const go = (event: React.MouseEvent, node: TextNodeKey) => { event.stopPropagation(); if (mode === "prototype") { const target = targets[node]; if (target) onNavigate(target.id); else onMissing(node); } else if (mode === "edit") onSelect(node); };
  const flowClass = (node: TextNodeKey) => mode !== "prototype" ? "" : targets[node] ? "flow-linked" : "flow-missing";
  const textStyle = (node: TextNodeKey) => { const style = design.styles[node]; return { fontFamily: style.font, fontSize: cssSize(style), lineHeight: style.lineHeight, fontWeight: style.weight, fontStyle: style.italic ? "italic" : "normal", color: style.color, textAlign: style.align, whiteSpace: "pre-wrap" as const }; };
  const editable = (node: TextNodeKey) => ({
    "data-node-selected": active && selectedNode === node,
    style: textStyle(node), contentEditable: mode === "edit", suppressContentEditableWarning: true,
    onClick: (event: React.MouseEvent) => choose(event, node), onBlur: (event: React.FocusEvent<HTMLElement>) => onInlineText(node, event.currentTarget.innerText),
  });
  const isDemoRoute = ["home", "pricing", "welcome", "settings"].includes(frame.id);
  const ProfileIcon = PROFILE_ICONS[frame.profile ?? "desktop"];
  const isLive = representation === "live" && Boolean(liveBaseUrl);
  const viewportWidth = frame.viewportWidth ?? RESPONSIVE_PROFILES.desktop.width;
  const viewportHeight = frame.viewportHeight ?? RESPONSIVE_PROFILES.desktop.height;
  const previewHeight = Math.max(120, frame.height - 24);
  const iframeScale = Math.min(frame.width / viewportWidth, previewHeight / viewportHeight);
  const previewUrl = liveBaseUrl ? (() => { const url = new URL(frame.route.replace(/^\//, ""), liveBaseUrl.endsWith("/") ? liveBaseUrl : `${liveBaseUrl}/`); url.searchParams.set("__ah_frame", frame.id); url.searchParams.set("__ah_scroll_y", String(frame.scroll?.windowY ?? 0)); return url.toString(); })() : null;
  return <article className={`route-frame ${active ? "active-frame" : ""} ${mode === "prototype" ? "prototype-frame" : ""}`} style={{ left: frame.x, top: frame.y, width: frame.width }} data-frame-id={frame.id}>
    <header className="frame-label"><div><ProfileIcon size={12} /><strong>{frame.name}</strong><span>{frame.route}</span><span className="viewport-pill">{frame.profile ?? "desktop"} · {viewportWidth}×{viewportHeight}</span></div><div className="frame-date"><button className={frame.pinned ? "pin active" : "pin"} onClick={(event) => { event.stopPropagation(); onPin(); }} title="Pin as a live comparison"><Pin size={10} /></button><span>{dateLabel(frame.updatedAt)} · {timeLabel(frame.updatedAt)}</span><span className="state-pill">{frame.state}</span></div></header>
    <div className={`browser-frame representation-${representation}`} style={{ height: frame.height }} onDoubleClick={onFocus} onClick={() => !isLive && mode === "edit" && onSelect("headline")}>
      <div className="browser-bar"><div className="traffic"><i /><i /><i /></div><div className="address">workspace{frame.route}</div><Maximize2 size={12} /></div>
      {isLive && previewUrl ? <div className="live-iframe-viewport" style={{ height: previewHeight }}><iframe title={`${frame.name} ${frame.profile ?? "desktop"} live preview`} src={previewUrl} allow="cross-origin-isolated" style={{ width: viewportWidth, height: viewportHeight, transform: `scale(${iframeScale})` }} /></div> : <div className={`mini-site mini-${frame.id} vertical-${design.vertical}`}>
        <nav><span className="mini-logo"><i style={{ background: frame.accent }} /><span {...editable("brand")}>{design.content.brand}</span></span><div><span className={flowClass("navProduct")} onClick={(event) => go(event, "navProduct")}><span {...editable("navProduct")}>{design.content.navProduct}</span></span><span className={flowClass("navCompany")} onClick={(event) => go(event, "navCompany")}><span {...editable("navCompany")}>{design.content.navCompany}</span></span><span className={flowClass("navDocs")} onClick={(event) => go(event, "navDocs")}><span {...editable("navDocs")}>{design.content.navDocs}</span></span></div><button className={flowClass("navAction")} onClick={(event) => go(event, "navAction")}><span {...editable("navAction")}>{design.content.navAction}</span></button></nav>
        {frame.id === "home" && <div className="hero-mini route-content"><p className="eyebrow" {...editable("eyebrow")}>{design.content.eyebrow}</p><h2 {...editable("headline")}>{design.content.headline}</h2><p {...editable("supporting")}>{design.content.supporting}</p><div className="mini-actions"><button className={flowClass("primaryAction")} onClick={(event) => go(event, "primaryAction")}><span {...editable("primaryAction")}>{design.content.primaryAction}</span><ChevronRight size={12} /></button><button className={`quiet ${flowClass("secondaryAction")}`} onClick={(event) => go(event, "secondaryAction")}><span {...editable("secondaryAction")}>{design.content.secondaryAction}</span></button></div></div>}
        {frame.id === "pricing" && <div className="pricing-mini route-content"><p className="eyebrow" {...editable("eyebrow")}>{design.content.eyebrow}</p><h2 {...editable("headline")}>{design.content.headline}</h2><p className="route-supporting" {...editable("supporting")}>{design.content.supporting}</p><div className="price-cards"><div><span>Starter</span><strong>$0</strong><small>For trying the canvas</small></div><div className={`featured ${flowClass("primaryAction")}`} onClick={(event) => go(event, "primaryAction")}><span {...editable("primaryAction")}>{design.content.primaryAction}</span><strong>$20</strong><small>For product teams</small></div></div></div>}
        {frame.id === "welcome" && <div className="welcome-mini route-content"><div className="success-ring"><Check size={22} /></div><p className="eyebrow" {...editable("eyebrow")}>{design.content.eyebrow}</p><h2 {...editable("headline")}>{design.content.headline}</h2><p {...editable("supporting")}>{design.content.supporting}</p><button className={flowClass("primaryAction")} onClick={(event) => go(event, "primaryAction")}><span {...editable("primaryAction")}>{design.content.primaryAction}</span></button></div>}
        {frame.id === "settings" && <div className="settings-mini route-content"><aside><i /><i /><i /><i /></aside><section><p className="eyebrow" {...editable("eyebrow")}>{design.content.eyebrow}</p><h2 {...editable("headline")}>{design.content.headline}</h2><p className="route-supporting" {...editable("supporting")}>{design.content.supporting}</p><label>Workspace name<input value="Northstar" readOnly /></label><label>Accent color<div className="color-field"><i /><span>#3478F6</span></div></label><button className={flowClass("primaryAction")} onClick={(event) => go(event, "primaryAction")}><span {...editable("primaryAction")}>{design.content.primaryAction}</span></button></section></div>}
        {!isDemoRoute && <div className="generic-mini route-content"><p className="eyebrow" {...editable("eyebrow")}>{design.content.eyebrow}</p><h2
          {...editable("headline")}
        >{design.content.headline}</h2><p {...editable("supporting")}>{design.content.supporting}</p><button className={flowClass("primaryAction")} onClick={(event) => go(event, "primaryAction")}><span {...editable("primaryAction")}>{design.content.primaryAction}</span><ChevronRight size={12} /></button></div>}
        {mode === "prototype" && (targets.primaryAction ? <button className="prototype-hotspot" onClick={(event) => go(event, "primaryAction")}><ArrowRight size={12} /> Opens {targets.primaryAction.name}</button> : <button className="prototype-hotspot missing" onClick={(event) => go(event, "primaryAction")}><Plus size={12} /> Missing next state</button>)}
        {representation === "thumbnail" && <div className="thumbnail-cover"><span>Static canvas thumbnail</span><small>Double-click for a scrollable focus preview</small></div>}
      </div>}
    </div>
    <footer className="frame-meta"><span>{representation === "live" ? "Scrollable live iframe" : "Static cached representation"}</span><span className={`verification-state ${frame.verification ?? "not_verified"}`}>{gapCount ? `${gapCount} flow gap${gapCount === 1 ? "" : "s"}` : verificationLabel(frame.verification ?? (isLive ? "source_synchronized" : "thumbnail_stale"))}</span></footer>
  </article>;
}

export function AgentHarness() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const [workspaces, setWorkspaces] = useState<WorkspaceSpec[]>([firstWorkspace]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(firstWorkspace.id);
  const [storageReady, setStorageReady] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true); const [rightOpen, setRightOpen] = useState(true); const [leftWidth, setLeftWidth] = useState(278);
  const [mode, setMode] = useState<CanvasMode>("edit"); const [inspectorTab, setInspectorTab] = useState<InspectorTab>("design");
  const [zoom, setZoom] = useState(.82); const [pan, setPan] = useState({ x: 60, y: 18 }); const [selectedFrame, setSelectedFrame] = useState("home"); const [selected, setSelected] = useState("home:headline");
  const [transactions, setTransactions] = useState<EditTransaction[]>([]); const [toast, setToast] = useState<string | null>(null);
  const [composer, setComposer] = useState(""); const [agentStatus, setAgentStatus] = useState<"idle" | "thinking" | "done">("idle"); const [agentReply, setAgentReply] = useState<string | null>(null); const [agentMeta, setAgentMeta] = useState({ time: "", duration: "" }); const [agentReceipt, setAgentReceipt] = useState<AgentReceipt | null>(null); const [attachedGap, setAttachedGap] = useState<FlowGap | null>(null); const agentAbort = useRef<AbortController | null>(null);
  const [draggingCanvas, setDraggingCanvas] = useState(false); const dragOrigin = useRef({ clientX: 0, clientY: 0, panX: 0, panY: 0 });
  const [workspaceModal, setWorkspaceModal] = useState(false); const [workspaceTab, setWorkspaceTab] = useState<"create" | "github">("create"); const [workspaceName, setWorkspaceName] = useState(""); const [repositoryUrl, setRepositoryUrl] = useState(""); const [trusted, setTrusted] = useState(false); const [importing, setImporting] = useState(false); const [importError, setImportError] = useState<string | null>(null);
  const [pageModal, setPageModal] = useState(false); const [pageMode, setPageMode] = useState<"duplicate" | "blank">("duplicate"); const [pageName, setPageName] = useState(""); const [pageRoute, setPageRoute] = useState(""); const [flowFilter, setFlowFilter] = useState(false); const [resolvingGapId, setResolvingGapId] = useState<string | null>(null);
  const [keyStatus, setKeyStatus] = useState<ApiKeyStatus>({ loading: true, connected: false, models: [] }); const [keyModal, setKeyModal] = useState(false); const [apiKey, setApiKey] = useState(""); const [keyError, setKeyError] = useState<string | null>(null); const [keyValidating, setKeyValidating] = useState(false);
  const [brandModal, setBrandModal] = useState(false); const [brandBusy, setBrandBusy] = useState<"extract" | "improve" | null>(null); const [brandSummary, setBrandSummary] = useState<{ rules?: string[]; authoritative?: unknown[] } | null>(null); const [documentProposals, setDocumentProposals] = useState<DocumentProposal[]>([]); const [brandError, setBrandError] = useState<string | null>(null);
  const [livePreview, setLivePreview] = useState<{ workspaceId: string; status: LivePreviewEvent["status"]; message: string; url: string | null }>({ workspaceId: "", status: "idle", message: "Live repository preview is not running.", url: null });
  const [focusFrameId, setFocusFrameId] = useState<string | null>(null); const [verificationModal, setVerificationModal] = useState(false); const [validationStatus, setValidationStatus] = useState<ValidationStatus>("not_verified");
  const [sourceDraft, setSourceDraft] = useState(""); const [sourceOriginal, setSourceOriginal] = useState(""); const [sourcePath, setSourcePath] = useState(""); const [sourceBusy, setSourceBusy] = useState(false); const [sourceError, setSourceError] = useState<string | null>(null);
  const textEditStart = useRef(""); const sizeEditStart = useRef(0);
  const workspace = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0];
  const selectedSpec = workspace.frames.find((frame) => frame.id === selectedFrame) ?? workspace.frames[0];
  const selectedDesign = normalizeRouteDesign(workspace.designs[selectedSpec.id], selectedSpec.name, "Route-specific design state.");
  const selectedNode = TEXT_NODE_KEYS.includes(selected.split(":").at(-1) as TextNodeKey) ? selected.split(":").at(-1) as TextNodeKey : "headline";
  const selectedContent = selectedDesign.content[selectedNode]; const selectedStyle = selectedDesign.styles[selectedNode]; const selectedMeta = NODE_META[selectedNode];
  const modeCopy = MODE_COPY[mode];
  const activeTransactions = transactions.filter((transaction) => transaction.workspaceId === workspace.id);
  const activeGaps = (workspace.gaps ?? []).filter((gap) => gap.status === "open");
  const projectPayload = { id: workspace.id, name: workspace.name, repository: workspace.repository, baseSha: workspace.baseSha };

  useEffect(() => {
    try {
      const saved = localStorage.getItem("agent-harness-workspaces-v1");
      if (saved) {
        const parsed = JSON.parse(saved) as { workspaces: WorkspaceSpec[]; transactions: EditTransaction[] };
        if (parsed.workspaces?.length) {
          const normalized = parsed.workspaces.map((item) => ({ ...item, frames: item.frames.map(withFrameDefaults), connections: item.connections ?? (item.id === firstWorkspace.id ? firstWorkspace.connections : {}), gaps: item.gaps ?? [], designs: Object.fromEntries(item.frames.map((frame) => {
            const stored = item.designs?.[frame.id]; const design = normalizeRouteDesign(stored, frame.name, "Route-specific design state."); const demo = firstWorkspace.designs[frame.id];
            if (demo && (!stored || !("content" in stored))) design.content = { ...demo.content, headline: design.content.headline, supporting: design.content.supporting };
            return [frame.id, design];
          })) }));
          setWorkspaces(normalized); setActiveWorkspaceId(normalized[0].id); setSelectedFrame(normalized[0].frames[0].id);
        }
        if (Array.isArray(parsed.transactions)) setTransactions(parsed.transactions);
      }
    } catch { localStorage.removeItem("agent-harness-workspaces-v1"); }
    setStorageReady(true);
  }, []);
  useEffect(() => () => { void import("../lib/live-preview-client").then(({ stopLiveRepositoryPreview }) => stopLiveRepositoryPreview()); }, []);
  useEffect(() => {
    if (!livePreview.url || livePreview.status !== "ready") return;
    const expectedOrigin = new URL(livePreview.url).origin;
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== expectedOrigin || event.data?.type !== "agent-harness:scroll" || typeof event.data.frameId !== "string") return;
      setWorkspaces((items) => items.map((item) => item.id !== livePreview.workspaceId ? item : { ...item, frames: item.frames.map((frame) => frame.id !== event.data.frameId ? frame : { ...frame, scroll: { windowX: Number(event.data.x || 0), windowY: Number(event.data.y || 0), containers: frame.scroll?.containers ?? [], capturedAt: typeof event.data.capturedAt === "string" ? event.data.capturedAt : now() } }) }));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [livePreview.status, livePreview.url, livePreview.workspaceId]);
  useEffect(() => {
    if (storageReady) localStorage.setItem("agent-harness-workspaces-v1", JSON.stringify({ workspaces, transactions }));
  }, [storageReady, transactions, workspaces]);
  useEffect(() => {
    let active = true;
    void fetch("/api/settings/openai-key", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json().catch(() => ({ connected: false }));
      if (!active) return;
      const status = { loading: false, connected: Boolean(payload.connected), masked: payload.masked, models: Array.isArray(payload.models) ? payload.models : [], validatedAt: payload.validatedAt };
      setKeyStatus(status);
      if (!status.connected) setKeyModal(true);
    }).catch(() => { if (active) { setKeyStatus({ loading: false, connected: false, models: [] }); setKeyModal(true); } });
    return () => { active = false; };
  }, []);

  const commit = (property: string, before: string, after: string, target = selectedSpec) => {
    if (before === after) return;
    const stamp = now();
    setTransactions((items) => [{ id: crypto.randomUUID(), workspaceId: workspace.id, frameId: target.id, timestamp: timeLabel(stamp), date: dateLabel(stamp), target: `${workspace.name} / ${target.name}`, property, before, after, status: "validated" }, ...items]);
    setToast(`${target.name} updated · ${timeLabel(stamp)}`); window.setTimeout(() => setToast(null), 1800);
  };
  const updateRouteDesign = (frameId: string, updater: (design: RouteDesignData) => RouteDesignData, property?: string, before?: string, after?: string) => {
    const stamp = now();
    const target = workspace.frames.find((frame) => frame.id === frameId) ?? selectedSpec;
    const sourceRouteId = frameRouteIdentity(target);
    setWorkspaces((items) => items.map((item) => {
      if (item.id !== workspace.id) return item;
      const related = item.frames.filter((frame) => frameRouteIdentity(frame) === sourceRouteId);
      const nextDesigns = { ...item.designs };
      for (const frame of related) nextDesigns[frame.id] = updater(normalizeRouteDesign(item.designs[frame.id], target.name, "Route-specific design state."));
      return { ...item, updatedAt: stamp, frames: item.frames.map((frame) => frameRouteIdentity(frame) === sourceRouteId ? { ...frame, updatedAt: stamp, verification: "not_verified" as const } : frame), designs: nextDesigns };
    }));
    if (property && before !== undefined && after !== undefined) commit(property, before, after, target);
  };
  const updateNodeContent = (frameId: string, node: TextNodeKey, value: string, before?: string) => updateRouteDesign(frameId, (design) => ({ ...design, content: { ...design.content, [node]: value } }), `${node}.text`, before, value);
  const updateNodeStyle = (patch: Partial<typeof selectedStyle>, property?: string, before?: string, after?: string) => updateRouteDesign(selectedSpec.id, (design) => ({ ...design, styles: { ...design.styles, [selectedNode]: { ...design.styles[selectedNode], ...patch } } }), property ? `${selectedNode}.${property}` : undefined, before, after);
  const updateVertical = (vertical: RouteDesignData["vertical"], before: string) => updateRouteDesign(selectedSpec.id, (design) => ({ ...design, vertical }), "route.vertical-align", before, vertical);
  const targetsForFrame = (frameId: string) => Object.fromEntries(Object.entries(workspace.connections?.[frameId] ?? {}).map(([node, targetId]) => [node, workspace.frames.find((frame) => frame.id === targetId)]).filter((entry) => Boolean(entry[1]))) as Partial<Record<TextNodeKey, FrameSpec>>;
  const selectFrame = (id: string, node: TextNodeKey = "headline") => { setSelectedFrame(id); setSelected(`${id}:${node}`); };
  const centerFrame = useCallback((frameId: string, fromPrototype = false) => {
    const current = workspaces.find((item) => item.id === activeWorkspaceId) ?? workspaces[0]; const frame = current.frames.find((item) => item.id === frameId);
    if (!frame || !canvasRef.current) return; const rect = canvasRef.current.getBoundingClientRect(); const prior = current.frames.find((item) => item.id === selectedFrame);
    selectFrame(frameId); setPan({ x: rect.width / 2 - (frame.x + frame.width / 2) * zoom, y: rect.height / 2 - (frame.y + frame.height / 2) * zoom });
    if (fromPrototype) { setToast(`Prototype flow · ${prior?.name ?? "Frame"} → ${frame.name}`); window.setTimeout(() => setToast(null), 1800); }
  }, [activeWorkspaceId, selectedFrame, workspaces, zoom]);
  const startCanvasDrag = (event: ReactPointerEvent<HTMLDivElement>) => { if ((event.target as HTMLElement).closest(".route-frame")) return; dragOrigin.current = { clientX: event.clientX, clientY: event.clientY, panX: pan.x, panY: pan.y }; setDraggingCanvas(true); event.currentTarget.setPointerCapture(event.pointerId); };
  const moveCanvas = (event: ReactPointerEvent<HTMLDivElement>) => { if (draggingCanvas) setPan({ x: dragOrigin.current.panX + event.clientX - dragOrigin.current.clientX, y: dragOrigin.current.panY + event.clientY - dragOrigin.current.clientY }); };
  const resizeSidebar = (event: ReactPointerEvent<HTMLDivElement>) => { const start = event.clientX; const width = leftWidth; const onMove = (move: PointerEvent) => setLeftWidth(Math.max(220, Math.min(430, width + move.clientX - start))); const onUp = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", onUp); }; window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", onUp); };

  const togglePinnedFrame = (frameId: string) => setWorkspaces((items) => items.map((item) => item.id !== workspace.id ? item : { ...item, frames: item.frames.map((frame) => frame.id === frameId ? { ...frame, pinned: !frame.pinned } : frame) }));
  const startRepositoryPreview = async () => {
    if (!workspace.repositoryUrl || !workspace.baseRef) { setLivePreview({ workspaceId: workspace.id, status: "error", message: "This workspace has no downloadable GitHub archive reference.", url: null }); return; }
    if (!window.confirm("Run this repository’s dependency installation and development scripts inside the isolated browser runtime? Only continue for code you trust.")) return;
    setLivePreview({ workspaceId: workspace.id, status: "downloading", message: "Preparing the repository…", url: null });
    try {
      const { startLiveRepositoryPreview } = await import("../lib/live-preview-client");
      const url = await startLiveRepositoryPreview({ workspaceId: workspace.id, repositoryUrl: workspace.repositoryUrl, ref: workspace.baseRef, onEvent: (event) => setLivePreview({ workspaceId: workspace.id, status: event.status, message: event.message, url: event.url ?? null }) });
      setLivePreview({ workspaceId: workspace.id, status: "ready", message: "Real repository preview ready.", url });
      setWorkspaces((items) => items.map((item) => item.id !== workspace.id ? item : { ...item, frames: item.frames.map((frame) => ({ ...frame, verification: "source_synchronized" as const })) }));
    } catch (error) { setLivePreview({ workspaceId: workspace.id, status: "error", message: (error as Error).message, url: null }); }
  };
  const loadSourceFile = async () => {
    if (!selectedSpec.sourceFile || livePreview.workspaceId !== workspace.id || livePreview.status !== "ready") { setSourceError("Start the live repository preview and select a route with a mapped JSX/TSX file first."); return; }
    setSourceBusy(true); setSourceError(null);
    try { const { readLiveSource } = await import("../lib/live-preview-client"); const source = await readLiveSource(selectedSpec.sourceFile); setSourcePath(selectedSpec.sourceFile); setSourceOriginal(source); setSourceDraft(source); }
    catch (error) { setSourceError((error as Error).message); } finally { setSourceBusy(false); }
  };
  const applySourceFile = async () => {
    if (!sourcePath || sourceDraft === sourceOriginal) return;
    setSourceBusy(true); setSourceError(null);
    try {
      if (/\.(?:t|j)sx?$/.test(sourcePath)) parse(sourceDraft, { sourceType: "module", plugins: ["jsx", "typescript"] });
      const { writeLiveSource } = await import("../lib/live-preview-client"); await writeLiveSource(sourcePath, sourceDraft);
      const before = sourceOriginal; setSourceOriginal(sourceDraft); commit(`${sourcePath} · direct source edit`, before, sourceDraft);
      setWorkspaces((items) => items.map((item) => item.id !== workspace.id ? item : { ...item, updatedAt: now(), frames: item.frames.map((frame) => frameRouteIdentity(frame) === frameRouteIdentity(selectedSpec) ? { ...frame, updatedAt: now(), verification: "source_synchronized" as const } : frame) }));
      setToast(`${sourcePath} updated · HMR requested`); window.setTimeout(() => setToast(null), 2200);
    } catch (error) { setSourceError((error as Error).message); } finally { setSourceBusy(false); }
  };
  const registerWorkflowMissing = async () => {
    if (!/^[a-f0-9]{7,64}$/i.test(workspace.baseSha)) { setValidationStatus("not_verified"); return; }
    try {
      const response = await fetch(`/api/projects/${encodeURIComponent(workspace.id)}/validations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectPayload, commitSha: workspace.baseSha, affectedRoutes: [...new Set(workspace.frames.map((frame) => frame.route))], trusted: true, workflowInstalled: false }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to register validation setup.");
      setValidationStatus(payload.status); setToast("Verification remains unavailable until the repository workflow is installed."); window.setTimeout(() => setToast(null), 2600);
    } catch (error) { setValidationStatus("actions_disabled"); setToast((error as Error).message); window.setTimeout(() => setToast(null), 2600); }
  };

  const validateApiKey = async () => {
    if (!apiKey.trim()) return;
    setKeyValidating(true); setKeyError(null);
    try {
      const response = await fetch("/api/settings/openai-key/validate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ apiKey: apiKey.trim() }) });
      const payload = await response.json().catch(() => ({ error: "Key validation failed." }));
      if (!response.ok) throw new Error(payload.error);
      setKeyStatus({ loading: false, connected: true, masked: payload.masked, models: payload.models ?? [], validatedAt: payload.validatedAt });
      setApiKey(""); setKeyModal(false); setToast(`Personal key connected · ${payload.masked}`); window.setTimeout(() => setToast(null), 2200);
    } catch (error) { setKeyError((error as Error).message); } finally { setKeyValidating(false); }
  };
  const forgetApiKey = async () => {
    await fetch("/api/settings/openai-key", { method: "DELETE" });
    setKeyStatus({ loading: false, connected: false, models: [] }); setApiKey(""); setKeyModal(true);
  };
  const requireAgentKey = () => { if (keyStatus.connected) return true; setKeyModal(true); setKeyError("Connect your personal OpenAI API key to use this agent action."); return false; };
  const persistGap = (gap: FlowGap) => { void fetch("/api/projects/flow-gaps", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectPayload, gap }) }).catch(() => undefined); };
  const openGapInChat = (gap: FlowGap) => {
    const frame = workspace.frames.find((item) => item.id === gap.frameId) ?? selectedSpec;
    selectFrame(gap.frameId, gap.node); setInspectorTab("layers"); setRightOpen(true); setAttachedGap(gap); setComposer(flowGapPrompt(gap, frame.name, workspace.name));
    window.setTimeout(() => composerRef.current?.focus(), 80);
  };

  const openPageModal = (mode: "duplicate" | "blank", gap?: FlowGap) => {
    const suggestedName = gap ? `${gap.label} page` : mode === "duplicate" ? `${selectedSpec.name} copy` : "New page";
    const suggestedRoute = gap?.suggestedRoute ?? `/${suggestedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`;
    if (gap && !workspace.gaps.some((item) => item.id === gap.id)) setWorkspaces((items) => items.map((item) => item.id === workspace.id ? { ...item, gaps: [...item.gaps, gap] } : item));
    setPageMode(mode); setPageName(suggestedName); setPageRoute(suggestedRoute); setResolvingGapId(gap?.id ?? null); setPageModal(true);
  };
  const createPage = () => {
    const stamp = now(); const id = crypto.randomUUID(); const cleanedRoute = `/${pageRoute.trim().replace(/^\/+/, "")}`.replace(/\/$/, "") || "/new-page";
    const route = workspace.frames.some((frame) => frame.route === cleanedRoute) ? `${cleanedRoute}-${workspace.frames.length + 1}` : cleanedRoute;
    const index = workspace.frames.length; const frame: FrameSpec = { id, route, name: pageName.trim() || "New page", state: pageMode === "duplicate" ? `Copied from ${selectedSpec.name}` : "Draft", x: 80 + (index % 3) * 490, y: 80 + Math.floor(index / 3) * 375, width: selectedSpec.width, height: selectedSpec.height, accent: workspace.brand.colors[index % workspace.brand.colors.length], updatedAt: stamp };
    const design = pageMode === "duplicate" ? cloneRouteDesign(selectedDesign) : baseDesign(frame.name, "Describe what this page helps the user accomplish.");
    setWorkspaces((items) => items.map((item) => {
      if (item.id !== workspace.id) return item;
      const gap = item.gaps.find((candidate) => candidate.id === resolvingGapId);
      const connections = gap ? { ...item.connections, [gap.frameId]: { ...(item.connections[gap.frameId] ?? {}), [gap.node]: frame.id }, [frame.id]: {} } : { ...item.connections, [frame.id]: {} };
      return { ...item, updatedAt: stamp, frames: [...item.frames, frame], designs: { ...item.designs, [frame.id]: design }, connections, gaps: resolvingGapId ? resolveFlowGap(item.gaps, resolvingGapId) : item.gaps };
    }));
    const resolved = workspace.gaps.find((gap) => gap.id === resolvingGapId);
    if (resolved) { const linked = { ...resolved, status: "resolved" as const, transactionId: `route:${frame.id}` }; persistGap(linked); if (attachedGap?.id === resolved.id) setAttachedGap(null); }
    setSelectedFrame(frame.id); setSelected(`${frame.id}:headline`); setPageModal(false); setResolvingGapId(null); setToast(`${frame.name} created with a complete editable hierarchy`); window.setTimeout(() => setToast(null), 2400);
  };
  const logMissingInteraction = (frameId: string, node: TextNodeKey) => {
    const stamp = now(); const design = normalizeRouteDesign(workspace.designs[frameId], "Page", ""); const label = design.content[node];
    const previous = workspace.gaps.find((gap) => gap.frameId === frameId && gap.node === node);
    const input = { id: previous?.id ?? crypto.randomUUID(), frameId, node, label, lastClickedAt: stamp, suggestedRoute: `/${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "next-state"}`, role: NODE_META[node].tag === "button" ? "button" : "navigation link", sourceAnchor: { route: workspace.frames.find((frame) => frame.id === frameId)?.route ?? "/", group: NODE_META[node].group, node }, computedStyle: { fontSize: cssSize(design.styles[node]), color: design.styles[node].color, fontFamily: design.styles[node].font } };
    const next = recordFlowGap(workspace.gaps, input); const gap = next.find((item) => item.frameId === frameId && item.node === node)!;
    setWorkspaces((items) => items.map((item) => item.id !== workspace.id ? item : { ...item, updatedAt: stamp, gaps: next }));
    persistGap(gap); setFlowFilter(true); openGapInChat(gap); setToast(`Flow gap attached to chat: “${label}” has no destination`); window.setTimeout(() => setToast(null), 2600);
  };

  const createWorkspace = () => {
    const id = crypto.randomUUID(); const stamp = now(); const frame = { ...initialFrames[0], id: `${id}-home`, updatedAt: stamp };
    const item: WorkspaceSpec = { id, name: workspaceName.trim() || "Untitled workspace", repository: "Local workspace", baseSha: "uncommitted", updatedAt: stamp, frames: [frame], designs: { [frame.id]: baseDesign("Start designing in code.", "This route is isolated from every other workspace.") }, connections: { [frame.id]: {} }, gaps: [], brand: { ...DEFAULT_BRAND } };
    setWorkspaces((items) => [...items, item]); setActiveWorkspaceId(id); setSelectedFrame(frame.id); setSelected(`${frame.id}:headline`); setAgentReply(null); setComposer(""); setWorkspaceModal(false); setWorkspaceName("");
  };
  const importWorkspace = async () => {
    if (!trusted) { setImportError("Confirm that you trust this repository before importing its code."); return; }
    setImporting(true); setImportError(null);
    try {
      const response = await fetch("/api/github/import", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repositoryUrl }) }); const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Import failed.");
      const stamp = now(); const id = crypto.randomUUID(); const discovered = payload.routes.length ? payload.routes : [{ route: "/", file: "src/App.tsx" }];
      const frames: FrameSpec[] = discovered.slice(0, 30).flatMap((route: { route: string; file?: string }, routeIndex: number) => {
        const sourceRouteId = `${id}-route-${routeIndex}`; const routeName = route.route === "/" ? "Home" : route.route.split("/").filter(Boolean).pop()?.replace(/[\[\]-]/g, " ") || "Route";
        return (Object.entries(RESPONSIVE_PROFILES) as Array<[ResponsiveProfile, (typeof RESPONSIVE_PROFILES)[ResponsiveProfile]]>).map(([profile, viewport], profileIndex) => ({
          id: `${sourceRouteId}--${profile}`, sourceRouteId, profile, viewportWidth: viewport.width, viewportHeight: viewport.height, sourceFile: route.file, scroll: EMPTY_SCROLL, verification: "thumbnail_stale" as const,
          route: route.route, name: `${routeName} · ${viewport.label}`, state: "Default", x: 80 + profileIndex * 490, y: 80 + routeIndex * 375, width: 430, height: 300, accent: payload.brand.colors[routeIndex % payload.brand.colors.length], updatedAt: stamp,
        }));
      });
      const designs = Object.fromEntries(frames.map((frame) => { const design = baseDesign(frame.name, `Imported from ${payload.repository.fullName}.`); for (const node of TEXT_NODE_KEYS) design.styles[node].font = payload.brand.fonts[0]; design.styles.headline.color = payload.brand.colors[0]; return [frame.id, design]; }));
      const item: WorkspaceSpec = { id, name: workspaceName.trim() || payload.repository.name, repository: payload.repository.fullName, repositoryUrl: payload.repository.url, baseSha: payload.repository.baseSha.slice(0, 7), baseRef: payload.repository.baseSha, updatedAt: stamp, frames, designs, connections: Object.fromEntries(frames.map((frame) => [frame.id, {}])), gaps: [], brand: payload.brand };
      setWorkspaces((items) => [...items, item]); setActiveWorkspaceId(id); setSelectedFrame(frames[0].id); setSelected(`${frames[0].id}:headline`); setAgentReply(null); setComposer(""); setWorkspaceModal(false); setRepositoryUrl(""); setWorkspaceName(""); setTrusted(false); setToast(`Imported ${frames.length} routes and ${payload.brand.colors.length} brand colors`); window.setTimeout(() => setToast(null), 2600);
    } catch (error) { setImportError((error as Error).message); } finally { setImporting(false); }
  };

  const brandRequest = () => ({ project: projectPayload, brand: { ...workspace.brand, documents: workspace.brand.documents ?? [] } });
  const extractBrandContext = async () => {
    setBrandBusy("extract"); setBrandError(null);
    try {
      const response = await fetch("/api/projects/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "extract", ...brandRequest() }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Extraction failed.");
      setBrandSummary(payload.summary); setWorkspaces((items) => items.map((item) => item.id === workspace.id ? { ...item, brand: { ...item.brand, documents: payload.documents } } : item));
      setToast(`Brand context extracted · ${payload.summary.rules.length} active rules`); window.setTimeout(() => setToast(null), 2200);
    } catch (error) { setBrandError((error as Error).message); } finally { setBrandBusy(null); }
  };
  const brainstormBrand = () => {
    if (!requireAgentKey()) return;
    setBrandModal(false); setAttachedGap(null);
    setComposer(`Review the extracted brand and design system for ${workspace.name}. Identify contradictions, missing decisions, reusable component principles, and opportunities to make the visual identity more distinctive without breaking the existing hierarchy. Keep new ideas clearly marked as proposals.`);
    window.setTimeout(() => composerRef.current?.focus(), 80);
  };
  const improveBrandDocuments = async () => {
    if (!requireAgentKey()) return;
    setBrandBusy("improve"); setBrandError(null);
    try {
      const response = await fetch("/api/projects/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "improve", ...brandRequest() }) });
      const payload = await response.json();
      if (response.status === 401) { setKeyStatus({ loading: false, connected: false, models: [] }); setKeyModal(true); }
      if (!response.ok) throw new Error(payload.error ?? "Document improvement failed.");
      setDocumentProposals(payload.proposals);
    } catch (error) { setBrandError((error as Error).message); } finally { setBrandBusy(null); }
  };
  const decideProposal = async (proposal: DocumentProposal, action: "apply" | "reject") => {
    setBrandError(null);
    const current = (workspace.brand.documents ?? []).find((document) => document.path === proposal.path);
    const currentHash = current ? await sha256(current.content) : undefined;
    try {
      const response = await fetch("/api/projects/context", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, project: projectPayload, proposalId: proposal.id, currentHash }) });
      const payload = await response.json(); if (!response.ok) throw new Error(payload.error ?? "Unable to update the proposal.");
      setDocumentProposals((items) => items.map((item) => item.id === proposal.id ? { ...item, status: action === "apply" ? "applied" : "rejected" } : item));
      if (action === "apply") {
        const sourceHash = await sha256(proposal.proposedContent); const document: BrandDocument = { path: proposal.path, kind: proposal.kind, content: proposal.proposedContent, sourceHash };
        setWorkspaces((items) => items.map((item) => item.id !== workspace.id ? item : { ...item, updatedAt: now(), brand: { ...item.brand, sourceFiles: item.brand.sourceFiles.includes(document.path) ? item.brand.sourceFiles : [...item.brand.sourceFiles, document.path], documents: [...(item.brand.documents ?? []).filter((candidate) => candidate.path !== document.path && candidate.kind !== document.kind), document] } }));
        commit(`${proposal.path}.markdown`, proposal.originalContent, proposal.proposedContent); setToast(`${proposal.path} applied to the draft workspace`); window.setTimeout(() => setToast(null), 2200);
      }
    } catch (error) { setBrandError((error as Error).message); }
  };

  const sendAgent = async () => {
    if (!composer.trim() || agentStatus === "thinking" || !requireAgentKey()) return; const prompt = composer.trim(); const startedAt = performance.now(); const controller = new AbortController(); agentAbort.current = controller; setComposer(""); setAgentReply(""); setAgentReceipt(null); setAgentStatus("thinking");
    try { const response = await fetch("/api/agent", { method: "POST", signal: controller.signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ project: projectPayload, threadId: `design-${workspace.id}`, prompt, model: "gpt-5.4-mini", attachedGapId: attachedGap?.id ?? null, contextReceipt: { frames: [selectedSpec.id], files: [selectedSpec.route === "/" ? "app/page.tsx" : `app${selectedSpec.route}/page.tsx`, ...(workspace.brand.documents ?? []).map((document) => document.path)], computedStyles: [`font-size:${cssSize(selectedStyle)}`, `color:${selectedStyle.color}`, `font-family:${selectedStyle.font}`], memoryIds: workspace.brand.sourceFiles, decisionIds: ["route-state-isolated", "source-is-truth", ...activeGaps.map((gap) => `flow-gap:${gap.frameId}:${gap.node}`)] } }) }); if (!response.ok || !response.body) { const payload = await response.json().catch(() => ({ error: "Agent request failed." })); if (response.status === 401) { setKeyStatus({ loading: false, connected: false, models: [] }); setKeyModal(true); } throw new Error(payload.error); } const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ""; let output = ""; while (true) { const { done, value } = await reader.read(); if (done) break; buffer += decoder.decode(value, { stream: true }); const lines = buffer.split("\n"); buffer = lines.pop() ?? ""; for (const line of lines) { if (!line.startsWith("data: ") || line === "data: [DONE]") continue; const event = JSON.parse(line.slice(6)); if (event.type === "agent.context_receipt") setAgentReceipt(event.receipt); if (event.type === "response.output_text.delta") { output += event.delta; setAgentReply(output); } } } if (!output) setAgentReply("The agent completed without a text response."); setAttachedGap(null); }
    catch (error) { setAgentReply((error as Error).name === "AbortError" ? "Request stopped. Partial work remains in this task." : `${(error as Error).message}\n\nCanvas editing remains available.`); }
    finally { setAgentMeta({ time: timeLabel(now()), duration: `${((performance.now() - startedAt) / 1000).toFixed(1)}s` }); setAgentStatus("done"); agentAbort.current = null; }
  };

  const addText = (addition: string) => updateNodeContent(selectedSpec.id, selectedNode, selectedContent + addition, selectedContent);
  const ModeIcon = modeCopy.icon;
  const modeIcon = <ModeIcon size={14} />;
  const selectedTargetId = workspace.connections?.[selectedSpec.id]?.[selectedNode]; const selectedTarget = workspace.frames.find((frame) => frame.id === selectedTargetId);
  const selectedGap = activeGaps.find((gap) => gap.frameId === selectedSpec.id && gap.node === selectedNode);
  const activeLiveUrl = livePreview.workspaceId === workspace.id && livePreview.status === "ready" ? livePreview.url : null;
  const liveFrameIds = chooseLiveFrameIds(workspace.frames.map((frame) => ({ ...frame, sourceRouteId: frameRouteIdentity(frame) })), selectedFrame, zoom, workspace.frames.some((frame) => frame.pinned) ? 3 : 2);
  const focusedFrame = workspace.frames.find((frame) => frame.id === focusFrameId) ?? null;
  const sourceClass = `${selectedSpec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${selectedNode.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;
  const sourceCode = `<${selectedMeta.tag} className="${sourceClass}">${selectedContent.replace(/\n/g, "\n  ")}</${selectedMeta.tag}>\n\n.${sourceClass} {\n  font-family: ${selectedStyle.font};\n  font-size: ${cssSize(selectedStyle)};\n  line-height: ${selectedStyle.lineHeight};\n  font-weight: ${selectedStyle.weight};\n  font-style: ${selectedStyle.italic ? "italic" : "normal"};\n  color: ${selectedStyle.color};\n  text-align: ${selectedStyle.align};\n}`;
  return <main className="harness-shell" style={{ gridTemplateColumns: `${leftOpen ? leftWidth : 54}px minmax(0, 1fr) ${rightOpen ? 304 : 0}px` }}>
    <aside className={`left-sidebar ${leftOpen ? "open" : "closed"}`}><div className="brand-row"><HarnessMark compact={!leftOpen} />{leftOpen && <div><strong>Design Harness</strong><span>Code-native design</span></div>}<button onClick={() => setLeftOpen(!leftOpen)}>{leftOpen ? <PanelLeftClose size={16} /> : <PanelLeftOpen size={16} />}</button></div>{leftOpen && <>
      <button className="new-workspace" onClick={() => setWorkspaceModal(true)}><Plus size={14} /> New workspace</button>
      <label className="workspace-picker"><span>WORKSPACE</span><select value={activeWorkspaceId} onChange={(event) => { const next = workspaces.find((item) => item.id === event.target.value)!; void import("../lib/live-preview-client").then(({ stopLiveRepositoryPreview }) => stopLiveRepositoryPreview()); setLivePreview({ workspaceId: next.id, status: "idle", message: "Live repository preview is not running.", url: null }); setActiveWorkspaceId(next.id); setSelectedFrame(next.frames[0].id); setSelected(`${next.frames[0].id}:headline`); setAgentReply(null); setAgentReceipt(null); setAttachedGap(null); setComposer(""); setSourceDraft(""); setSourceOriginal(""); setSourcePath(""); setPan({ x: 60, y: 18 }); }}><option disabled value="">Choose workspace</option>{workspaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      <button className="repo-switcher" onClick={() => setWorkspaceModal(true)}><GitBranch size={15} /><span><strong>{workspace.repository}</strong><small>Updated {dateLabel(workspace.updatedAt)} · {timeLabel(workspace.updatedAt)}</small></span><ChevronDown size={14} /></button>
      <div className="sidebar-search"><Search size={14} /><input placeholder="Search this workspace" /></div>
      <div className="side-section"><div className="section-title"><span>ROUTES · RESPONSIVE</span><button onClick={() => openPageModal("duplicate")} title="Add or duplicate a page"><Plus size={13} /></button></div>{workspace.frames.map((frame) => { const DeviceIcon = PROFILE_ICONS[frame.profile ?? "desktop"]; return <button key={frame.id} className={`route-item ${selectedFrame === frame.id ? "active" : ""}`} onClick={() => centerFrame(frame.id)}><DeviceIcon size={14} /><span><strong>{frame.name}</strong><small>{frame.route} · {frame.viewportWidth ?? 1440}px</small></span><i className={liveFrameIds.includes(frame.id) && activeLiveUrl ? "live-dot" : "thumbnail-dot"} /></button>; })}</div>
      <div className="side-section flow-gap-section"><div className="section-title"><span>FLOW GAPS · {activeGaps.length}</span><button onClick={() => setFlowFilter(!flowFilter)}><Eye size={13} /></button></div>{activeGaps.length ? activeGaps.slice(0, flowFilter ? 20 : 3).map((gap) => <button className="flow-gap-item" key={gap.id} onClick={() => openGapInChat(gap)}><span>!</span><div><strong>{gap.label}</strong><small>No next state · click to plan in chat</small></div><Sparkles size={12} /></button>) : <div className="no-flow-gaps"><Check size={12} /> No missing destinations logged</div>}</div>
      <div className="side-section"><div className="section-title"><span>SAVED STATES</span><button><Plus size={13} /></button></div><button className="state-item"><span className="state-glyph">◇</span><span>Success state</span><small>{dateLabel(workspace.updatedAt)}</small></button><button className="state-item"><span className="state-glyph">◇</span><span>Responsive state</span><small>{timeLabel(workspace.updatedAt)}</small></button></div>
      <button className="memory-card" onClick={() => setBrandModal(true)}><Palette size={15} /><div><strong>Brand & design intelligence</strong><span>{workspace.brand.colors.length} colors · {workspace.brand.fonts.length} fonts · {(workspace.brand.documents ?? []).length} docs</span></div><ChevronRight size={14} /></button>
      {workspace.repositoryUrl && <button className={`runtime-card ${livePreview.workspaceId === workspace.id ? livePreview.status : "idle"}`} onClick={() => void startRepositoryPreview()} disabled={["downloading", "mounting", "installing", "starting"].includes(livePreview.status) && livePreview.workspaceId === workspace.id}>{activeLiveUrl ? <RefreshCw size={15} /> : <Play size={15} />}<div><strong>{activeLiveUrl ? "Restart live repository" : "Run live repository"}</strong><span>{livePreview.workspaceId === workspace.id ? livePreview.message : "One WebContainer · explicit trust required"}</span></div></button>}
      <div className="workspace-status"><span><i />{activeLiveUrl ? `${liveFrameIds.length} live · ${Math.max(0, workspace.frames.length - liveFrameIds.length)} static` : "Static thumbnails · runtime stopped"}</span><small>{workspace.frames.length} responsive frame(s) · max 3 live</small></div>
    </>} {leftOpen && <div className="sidebar-resizer" onPointerDown={resizeSidebar} />}</aside>

    <section className="workspace"><header className="topbar"><div className="mode-group"><button className={mode === "edit" ? "active" : ""} onClick={() => setMode("edit")}><MousePointer2 size={14} />Edit page</button><button className={mode === "prototype" ? "active" : ""} onClick={() => setMode("prototype")}><Link2 size={14} />Preview flow</button><button className={mode === "graph" ? "active" : ""} onClick={() => setMode("graph")}><GitBranch size={14} />Graph</button></div><div className="session-title"><span>{workspace.name}</span><small>Draft · base {workspace.baseSha}</small></div><div className="toolbar-actions"><button className={`key-status ${keyStatus.connected ? "connected" : "missing"}`} onClick={() => setKeyModal(true)}><Bot size={14} /><span>{keyStatus.connected ? keyStatus.masked : "Set up AI"}</span></button><button><Undo2 size={15} /></button><button><Redo2 size={15} /></button><button onClick={() => openPageModal("duplicate")}><Copy size={14} /><span>Duplicate page</span></button><button><Grid2X2 size={14} /><span>Multi-select</span></button><button className={`publish-button validation-${validationStatus}`} onClick={() => setVerificationModal(true)}><ShieldCheck size={14} />{validationStatus === "passed" ? "Pixel verified" : "Verify production"}<span>{activeTransactions.length + activeGaps.length}</span></button></div></header>
      <div ref={canvasRef} className={`canvas-viewport mode-${mode} ${draggingCanvas ? "dragging" : ""}`} onPointerDown={startCanvasDrag} onPointerMove={moveCanvas} onPointerUp={() => setDraggingCanvas(false)}><div className="mode-explainer">{modeIcon}<div><strong>{modeCopy.title}</strong><span>{modeCopy.body}</span></div></div><div className="canvas-grid" style={{ transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, width: 1600, height: Math.max(820, Math.ceil(workspace.frames.length / 3) * 375 + 80) }}>
        {mode === "graph" && <svg className="graph-lines" width="1600" height="1200"><defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>{Object.entries(workspace.connections ?? {}).flatMap(([sourceId, connections]) => Object.entries(connections).map(([node, targetId]) => { const source = workspace.frames.find((frame) => frame.id === sourceId); const target = workspace.frames.find((frame) => frame.id === targetId); return !source || !target ? null : <path key={`${source.id}-${node}-${target.id}`} d={`M ${source.x + source.width} ${source.y + 190} C ${source.x + source.width + 55} ${source.y + 190}, ${target.x - 55} ${target.y + 190}, ${target.x} ${target.y + 190}`} markerEnd="url(#arrow)" />; }))}</svg>}
        {workspace.frames.map((frame) => { const design = normalizeRouteDesign(workspace.designs[frame.id], frame.name, "Route-specific design state."); const targets = targetsForFrame(frame.id); const gapCount = activeGaps.filter((gap) => gap.frameId === frame.id).length; const representation: PreviewRepresentation = workspace.repositoryUrl ? activeLiveUrl && liveFrameIds.includes(frame.id) ? "live" : "thumbnail" : "live"; return <FramePreview key={frame.id} frame={frame} design={design} mode={mode} active={selectedFrame === frame.id} selectedNode={selectedNode} targets={targets} gapCount={gapCount} representation={representation} liveBaseUrl={activeLiveUrl} onFocus={() => { setSelectedFrame(frame.id); if (activeLiveUrl) setFocusFrameId(frame.id); else setZoom(.82); }} onPin={() => togglePinnedFrame(frame.id)} onSelect={(node) => selectFrame(frame.id, node)} onNavigate={(targetId) => centerFrame(targetId, true)} onMissing={(node) => logMissingInteraction(frame.id, node)} onInlineText={(node, text) => { const previous = design.content[node]; if (text !== previous) { selectFrame(frame.id, node); updateNodeContent(frame.id, node, text, previous); } }} />; })}
      </div><div className="zoom-control"><button onClick={() => setZoom((value) => Math.max(.4, value - .1))}><ZoomOut size={14} /></button><button className="zoom-value" onClick={() => setZoom(.82)}>{Math.round(zoom * 100)}%</button><button onClick={() => setZoom((value) => Math.min(1.4, value + .1))}><ZoomIn size={14} /></button><i /><button onClick={() => { setZoom(.82); setPan({ x: 60, y: 18 }); }}><Maximize2 size={14} /></button></div></div>
      <section className="agent-dock">{agentReply && <div className="agent-response"><div className="agent-avatar"><Bot size={14} /></div><div><div className="response-meta"><strong>Design agent</strong><span>{agentMeta.time} · {agentMeta.duration}</span></div><p>{agentReply}</p>{agentReceipt && <details className="context-receipt"><summary>Context receipt</summary><div><span>{agentReceipt.documents?.length ?? 0} brand/design docs</span><span>{agentReceipt.approvedMemories?.length ?? 0} approved memories</span><span>{agentReceipt.openFlowGaps?.length ?? 0} open flow gaps</span><span>{agentReceipt.selected?.frames?.length ?? 0} selected frame</span></div></details>}</div><button onClick={() => navigator.clipboard.writeText(agentReply)} title="Copy response"><Copy size={14} /></button></div>}<div className={`composer ${agentStatus === "thinking" ? "thinking" : ""}`}><div className="composer-contexts"><div className="context-chip"><span className="frame-dot" style={{ background: selectedSpec.accent }} />{workspace.name} · {selectedSpec.route}</div>{attachedGap && <div className="context-chip gap-chip"><span>!</span>Flow gap · {attachedGap.label}<button onClick={() => setAttachedGap(null)}>×</button></div>}</div><textarea ref={composerRef} value={composer} onChange={(event) => setComposer(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void sendAgent(); } }} placeholder="Ask about this route without mixing other workspaces…" /><div className="composer-footer"><div><button><Plus size={16} /></button><span><Sparkles size={12} /> gpt-5.4 mini · {keyStatus.connected ? keyStatus.masked : "key required"}</span></div>{agentStatus === "thinking" ? <button className="send-button stop" onClick={() => agentAbort.current?.abort()}><CircleStop size={17} /></button> : <button className="send-button" onClick={() => void sendAgent()} disabled={!composer.trim()}><ArrowUp size={17} /></button>}</div>{agentStatus === "thinking" && <div className="thinking-line"><i /><span>Reading only {workspace.name} / {selectedSpec.name}…</span></div>}</div></section>
    </section>

    <aside className={`right-inspector ${rightOpen ? "open" : "closed"}`}>{rightOpen ? <><div className="inspector-head"><div><strong>{selectedSpec.name} inspector</strong><span>{selected} · updated {timeLabel(selectedSpec.updatedAt)}</span></div><button onClick={() => setRightOpen(false)}><PanelRightClose size={16} /></button></div><div className="inspector-tabs">{(["design", "layers", "code", "changes"] as InspectorTab[]).map((tab) => <button key={tab} className={inspectorTab === tab ? "active" : ""} onClick={() => setInspectorTab(tab)}>{tab}</button>)}</div>
      {inspectorTab === "design" && <div className="inspector-body"><div className="selection-path"><span>{selectedSpec.name}</span><ChevronRight size={11} /><span>{selectedMeta.group}</span><ChevronRight size={11} /><strong>{selectedMeta.label}</strong></div><section className="property-section text-editor"><header><span>{selectedMeta.label}</span><small>&lt;{selectedMeta.tag}&gt; · whitespace preserved</small></header><div className="copywrite-scope"><Code2 size={12} /><span>Copywriting is source-scoped and updates every {selectedSpec.profile ?? "desktop"}/responsive view of this route.</span></div><textarea value={selectedContent} onFocus={() => { textEditStart.current = selectedContent; }} onChange={(event) => updateNodeContent(selectedSpec.id, selectedNode, event.target.value)} onBlur={(event) => commit(`${selectedNode}.text`, textEditStart.current, event.target.value)} /><div className="text-actions"><button onClick={() => addText("\n")}><ArrowRight size={12} /> Line break</button><button onClick={() => addText(" ")}>· Space</button></div></section>
        <section className="property-section"><header><span>Layout</span><small>Node + route alignment</small></header><div className="alignment-grid">{Array.from({ length: 9 }).map((_, index) => { const align: TextAlign = (["left", "center", "right"] as TextAlign[])[index % 3]; const vertical = (["start", "center", "end"] as const)[Math.floor(index / 3)]; return <button key={index} className={selectedStyle.align === align && selectedDesign.vertical === vertical ? "active" : ""} onClick={() => { updateNodeStyle({ align }, "text-align", selectedStyle.align, align); if (vertical !== selectedDesign.vertical) updateVertical(vertical, selectedDesign.vertical); }}><i /></button>; })}</div><div className="format-row"><button className={selectedStyle.align === "left" ? "active" : ""} onClick={() => updateNodeStyle({ align: "left" }, "text-align", selectedStyle.align, "left")}><AlignLeft size={13} /></button><button className={selectedStyle.align === "center" ? "active" : ""} onClick={() => updateNodeStyle({ align: "center" }, "text-align", selectedStyle.align, "center")}><AlignCenter size={13} /></button><button className={selectedStyle.align === "right" ? "active" : ""} onClick={() => updateNodeStyle({ align: "right" }, "text-align", selectedStyle.align, "right")}><AlignRight size={13} /></button></div></section>
        <section className="property-section"><header><span>Typography</span><small>Applied to {selectedNode}</small></header><label className="wide-field"><span>Font</span><select value={selectedStyle.font} onChange={(event) => updateNodeStyle({ font: event.target.value }, "font-family", selectedStyle.font, event.target.value)}>{workspace.brand.fonts.map((font) => <option key={font}>{font}</option>)}</select></label><div className="field-row unit-row"><label><span>Size</span><input type="number" min="0" max="240" value={selectedStyle.size} onFocus={() => { sizeEditStart.current = selectedStyle.size; }} onChange={(event) => updateNodeStyle({ size: Number(event.target.value) })} onBlur={(event) => commit(`${selectedNode}.font-size`, `${sizeEditStart.current}${selectedStyle.unit}`, `${event.target.value}${selectedStyle.unit}`)} /></label><select value={selectedStyle.unit} onChange={(event) => updateNodeStyle({ unit: event.target.value as CssUnit }, "font-size-unit", selectedStyle.unit, event.target.value)}>{(["px", "rem", "em", "%"] as CssUnit[]).map((unit) => <option key={unit}>{unit}</option>)}</select></div><div className="field-row"><label><span>Line</span><input type="number" min=".7" max="3" step=".05" value={selectedStyle.lineHeight} onChange={(event) => updateNodeStyle({ lineHeight: Number(event.target.value) }, "line-height", String(selectedStyle.lineHeight), event.target.value)} /></label><label><span>Weight</span><input type="number" min="100" max="900" step="100" value={selectedStyle.weight} onChange={(event) => updateNodeStyle({ weight: Number(event.target.value) }, "font-weight", String(selectedStyle.weight), event.target.value)} /></label></div><div className="format-row"><button className={selectedStyle.weight >= 700 ? "active" : ""} onClick={() => updateNodeStyle({ weight: selectedStyle.weight >= 700 ? 400 : 700 }, "font-weight", String(selectedStyle.weight), String(selectedStyle.weight >= 700 ? 400 : 700))}><Bold size={13} /></button><button className={selectedStyle.italic ? "active" : ""} onClick={() => updateNodeStyle({ italic: !selectedStyle.italic }, "font-style", selectedStyle.italic ? "italic" : "normal", selectedStyle.italic ? "normal" : "italic")}><Italic size={13} /></button></div></section>
        <section className="property-section brand-section"><header><span>Brand colors</span><small>{workspace.brand.sourceFiles.length} source file(s)</small></header><div className="brand-swatches">{workspace.brand.colors.map((color) => <button key={color} className={selectedStyle.color.toUpperCase() === color.toUpperCase() ? "active" : ""} style={{ background: color }} onClick={() => updateNodeStyle({ color }, "color", selectedStyle.color, color)} aria-label={`Use ${color}`} />)}<label className="color-wheel"><Plus size={13} /><input type="color" value={selectedStyle.color} onChange={(event) => { const color = event.target.value.toUpperCase(); setWorkspaces((items) => items.map((item) => item.id === workspace.id ? { ...item, brand: { ...item.brand, colors: item.brand.colors.includes(color) ? item.brand.colors : [...item.brand.colors, color] } } : item)); updateNodeStyle({ color }, "custom-color", selectedStyle.color, color); }} /></label></div><p>{workspace.brand.sourceFiles.length ? `Loaded from ${workspace.brand.sourceFiles.slice(0, 2).join(" and ")}` : "Default palette. Add colors with the picker."}</p></section>
        {INTERACTION_NODES.includes(selectedNode) && <section className={`interaction-status ${selectedTarget ? "linked" : "missing"}`}><Link2 size={14} /><div><strong>{selectedTarget ? `Opens ${selectedTarget.name}` : "No next state designed"}</strong><span>{selectedTarget ? selectedTarget.route : "A prototype click will log this as a design opportunity."}</span></div>{!selectedTarget && <button onClick={() => openPageModal("duplicate", selectedGap ?? { id: crypto.randomUUID(), frameId: selectedSpec.id, node: selectedNode, label: selectedContent, firstSeenAt: now(), lastClickedAt: now(), clickCount: 0, suggestedRoute: `/${selectedContent.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, status: "open" })}><Plus size={12} />Add state</button>}</section>}
        <section className="source-anchor"><Code2 size={14} /><div><span>Hierarchy-preserving source anchor</span><strong>{selectedSpec.route} · {selectedMeta.group} · {selectedNode}</strong><small>Canvas, Layers, Design, and Code share this node ID</small></div><ChevronRight size={14} /></section></div>}
      {inspectorTab === "layers" && <div className="inspector-body layer-tree"><div><ChevronDown size={13} /><Layers3 size={13} /><strong>{selectedSpec.name}Page</strong></div>{(["Navigation", "Route content"] as const).map((group) => <div className="layer-group" key={group}><div className="indent"><ChevronDown size={13} /><Layers3 size={13} /><span>{group}</span></div>{TEXT_NODE_KEYS.filter((node) => NODE_META[node].group === group).map((node) => { const target = workspace.frames.find((frame) => frame.id === workspace.connections?.[selectedSpec.id]?.[node]); const gap = activeGaps.find((item) => item.frameId === selectedSpec.id && item.node === node); return <button key={node} className={`indent-2 ${selectedNode === node ? "active" : ""}`} onClick={() => selectFrame(selectedSpec.id, node)}><Code2 size={13} /><span>{NODE_META[node].tag} · {NODE_META[node].label}</span>{INTERACTION_NODES.includes(node) && <i className={target ? "layer-linked" : gap ? "layer-gap logged" : "layer-gap"}>{target ? `→ ${target.name}` : gap ? "gap logged" : "no state"}</i>}</button>; })}</div>)}{activeGaps.filter((gap) => gap.frameId === selectedSpec.id).map((gap) => <article className="gap-suggestion" key={gap.id}><header><span>DESIGN OPPORTUNITY</span><small>{dateLabel(gap.lastClickedAt)} · {timeLabel(gap.lastClickedAt)} · {gap.clickCount} click{gap.clickCount === 1 ? "" : "s"}</small></header><strong>“{gap.label}” has no destination</strong><p>Suggested next route: {gap.suggestedRoute}</p><div className="gap-actions"><button onClick={() => openGapInChat(gap)}><Sparkles size={12} />Plan in chat</button><button onClick={() => openPageModal("duplicate", gap)}><Plus size={12} />Create state</button></div></article>)}</div>}
      {inspectorTab === "code" && <div className="inspector-body code-panel"><div className="code-status"><Check size={12} /><span>{activeLiveUrl ? "Live source runtime connected" : "Source projection only"}</span><small>{cssSize(selectedStyle)}</small></div><div className="file-chip">{selectedSpec.sourceFile ?? (selectedSpec.route === "/" ? "app/page.tsx" : `app${selectedSpec.route}/page.tsx`)} · {selectedMeta.label}</div>{sourcePath ? <><label className="source-editor-label"><span>Direct JSX/TSX copy and code edit</span><small>Syntax is checked before writing to the running repository.</small></label><textarea className="source-editor" spellCheck={false} value={sourceDraft} onChange={(event) => setSourceDraft(event.target.value)} /><div className="source-actions"><button onClick={() => navigator.clipboard.writeText(sourceDraft)}><Copy size={13} />Copy file</button><button className="primary" disabled={sourceBusy || sourceDraft === sourceOriginal} onClick={() => void applySourceFile()}>{sourceBusy ? "Checking…" : "Apply to live .tsx"}</button></div>{sourceError && <p className="import-error">{sourceError}</p>}</> : <><pre>{sourceCode}</pre><p>{activeLiveUrl ? "Load the mapped route source to edit copy or JSX directly. The clean file remains local until an explicit draft commit and push." : "Start the trusted live repository runtime to edit the actual mapped JSX/TSX file. This projection is not the physical repository file."}</p><button onClick={() => void loadSourceFile()} disabled={sourceBusy || !activeLiveUrl || !selectedSpec.sourceFile}><Code2 size={13} />{sourceBusy ? "Loading…" : "Open actual route source"}</button><button onClick={() => navigator.clipboard.writeText(sourceCode)}><Copy size={13} />Copy projected source</button>{sourceError && <p className="import-error">{sourceError}</p>}</>}</div>}
      {inspectorTab === "changes" && <div className="inspector-body changes-list">{activeTransactions.length ? activeTransactions.map((tx) => <article key={tx.id}><header><span>{tx.target}</span><small>{tx.date} · {tx.timestamp}</small></header><strong>{tx.property}</strong><p><del>{tx.before}</del><ChevronRight size={11} /><ins>{tx.after}</ins></p><footer><Check size={11} />{tx.status}</footer></article>) : <div className="empty-changes">No changes in this workspace yet.</div>}</div>}<div className="inspector-footer"><button><Settings2 size={14} />{workspace.name} settings</button></div></> : <button className="open-inspector" onClick={() => setRightOpen(true)}><PanelRightOpen size={16} /></button>}</aside>
    {!rightOpen && <button className="floating-inspector" onClick={() => setRightOpen(true)}><PanelRightOpen size={17} /></button>}{toast && <div className="toast"><Check size={14} />{toast}</div>}

    {focusedFrame && activeLiveUrl && <div className="focus-preview-backdrop"><section className="focus-preview"><header><div><strong>{focusedFrame.name}</strong><span>{focusedFrame.route} · {focusedFrame.viewportWidth}×{focusedFrame.viewportHeight} · scrollable live preview</span></div><button onClick={() => setFocusFrameId(null)}>×</button></header><div className="focus-iframe-shell"><iframe title={`${focusedFrame.name} focus preview`} src={new URL(focusedFrame.route.replace(/^\//, ""), activeLiveUrl.endsWith("/") ? activeLiveUrl : `${activeLiveUrl}/`).toString()} allow="cross-origin-isolated" style={{ width: focusedFrame.viewportWidth, height: focusedFrame.viewportHeight }} /></div><footer><span><i />Live source synchronized</span><small>Static thumbnails cannot scroll; this focused iframe can.</small></footer></section></div>}

    {verificationModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setVerificationModal(false)}><section className="workspace-modal verification-modal"><header><div><span>PRODUCTION EVIDENCE</span><h2>GitHub Actions verification</h2><p>Headless Chromium can verify a pushed commit, but it is not the live canvas and it is not free or available in every repository.</p></div><button onClick={() => setVerificationModal(false)}>×</button></header><div className="modal-body"><div className={`verification-banner ${validationStatus}`}><ShieldCheck size={18} /><div><strong>{validationStatus === "passed" ? "Production pixel verified" : validationStatus === "workflow_missing" ? "Workflow missing" : "Not production verified"}</strong><span>Current canvas thumbnails and source projections do not qualify as production proof.</span></div></div><div className="actions-limitations"><strong>Known GitHub Actions limitations</strong>{ACTIONS_LIMITATIONS.map((limitation) => <p key={limitation}><AlertTriangle size={12} />{limitation}</p>)}</div><div className="verification-facts"><article><strong>Live iframe</strong><span>Interactive WebContainer route; scrollable; not headless.</span></article><article><strong>Thumbnail</strong><span>Static navigation aid; cannot scroll; never pixel-verified.</span></article><article><strong>Headless Chromium</strong><span>Runs only from an approved pushed SHA using the installed workflow.</span></article></div><div className="workflow-install"><Code2 size={17} /><div><strong>One-time repository setup</strong><span>Design Harness does not request Workflows write permission. The repository owner must install the workflow manually.</span></div><a href="/design-harness-visual.yml" download>Download workflow</a></div><label className="trust-check"><input type="checkbox" readOnly checked={false} /><span>No workflow connection has been proven for this workspace. Editing and export remain available, but the pixel-verified badge stays disabled.</span></label></div><footer><button className="cancel" onClick={() => setVerificationModal(false)}>Continue editing</button><button className="primary" onClick={() => void registerWorkflowMissing()}>Record workflow missing</button></footer></section></div>}

    {brandModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setBrandModal(false)}><section className="workspace-modal intelligence-modal"><header><div><span>PROJECT MEMORY</span><h2>Brand & design intelligence</h2><p>Extract the source of truth, brainstorm safely, and review document improvements before they affect this workspace.</p></div><button onClick={() => setBrandModal(false)}>×</button></header><div className="modal-body"><div className="intelligence-stats"><article><strong>{workspace.brand.colors.length}</strong><span>brand colors</span></article><article><strong>{workspace.brand.fonts.length}</strong><span>type families</span></article><article><strong>{(workspace.brand.documents ?? []).length}</strong><span>source docs</span></article></div><div className="intelligence-actions"><button onClick={() => void extractBrandContext()} disabled={Boolean(brandBusy)}><Palette size={15} /><span><strong>{brandBusy === "extract" ? "Extracting…" : "Extract context"}</strong><small>Read tokens, brand.md, design.md, and code patterns.</small></span></button><button onClick={brainstormBrand}><Sparkles size={15} /><span><strong>Brainstorm</strong><small>Open a brand-aware discussion without changing source.</small></span></button><button onClick={() => void improveBrandDocuments()} disabled={Boolean(brandBusy)}><Code2 size={15} /><span><strong>{brandBusy === "improve" ? "Generating review…" : "Improve docs"}</strong><small>Create reviewable brand.md and design.md diffs.</small></span></button></div>{brandSummary && <div className="memory-summary"><strong>Active context</strong>{brandSummary.rules?.map((rule) => <p key={rule}><Check size={11} />{rule}</p>)}</div>}{brandError && <p className="import-error">{brandError}</p>}{documentProposals.map((proposal) => <article className={`document-proposal ${proposal.status}`} key={proposal.id}><header><div><strong>{proposal.path}</strong><span>{proposal.kind} · {proposal.status}</span></div></header><p>{proposal.rationale}</p><details><summary>Review proposed Markdown diff</summary><pre>{proposal.diff}</pre></details>{proposal.status === "pending" && <footer><button className="cancel" onClick={() => void decideProposal(proposal, "reject")}>Reject</button><button className="primary" onClick={() => void decideProposal(proposal, "apply")}>Apply to draft</button></footer>}</article>)}</div><footer><button className="cancel" onClick={() => setBrandModal(false)}>Close</button></footer></section></div>}

    {keyModal && <div className="modal-backdrop key-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setKeyModal(false)}><section className="workspace-modal api-key-modal"><header><div><span>PERSONAL AI CONNECTION</span><h2>{keyStatus.connected ? "Your API key is connected" : "Connect your OpenAI API key"}</h2><p>The canvas works without AI. Connect a personal key for chat, flow planning, and document improvements.</p></div><button onClick={() => setKeyModal(false)}>×</button></header><div className="modal-body">{keyStatus.connected ? <><div className="key-success"><Check size={18} /><div><strong>{keyStatus.masked}</strong><span>Validated {keyStatus.validatedAt ? `${dateLabel(keyStatus.validatedAt)} · ${timeLabel(keyStatus.validatedAt)}` : "recently"}</span><small>{keyStatus.models.join(" · ")}</small></div></div><div className="security-note"><Bot size={16} /><p>The full key is encrypted in an HttpOnly cookie and is never stored in project memory, browser storage, D1, R2, logs, or source control.</p></div></> : <><label className="key-field"><span>OpenAI API key</span><input type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void validateApiKey(); }} placeholder="Paste your temporary or personal key" /></label><div className="security-note"><Bot size={16} /><p>The key is sent directly to this Site, validated against the required models, encrypted for this signed-in user, and never returned to JavaScript after setup.</p></div>{keyError && <p className="import-error">{keyError}</p>}</>}</div><footer>{keyStatus.connected ? <><button className="danger" onClick={() => void forgetApiKey()}>Forget key</button><button className="primary" onClick={() => setKeyModal(false)}>Done</button></> : <><button className="cancel" onClick={() => setKeyModal(false)}>Use canvas without AI</button><button className="primary" disabled={!apiKey.trim() || keyValidating} onClick={() => void validateApiKey()}>{keyValidating ? "Validating access…" : "Validate & connect"}</button></>}</footer></section></div>}

    {workspaceModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setWorkspaceModal(false)}><section className="workspace-modal"><header><div><span>AGENT HARNESS</span><h2>Start a workspace</h2><p>Every workspace owns its routes, states, brand tokens, and edit history.</p></div><button onClick={() => setWorkspaceModal(false)}>×</button></header><div className="modal-tabs"><button className={workspaceTab === "create" ? "active" : ""} onClick={() => setWorkspaceTab("create")}><Plus size={14} />Blank workspace</button><button className={workspaceTab === "github" ? "active" : ""} onClick={() => setWorkspaceTab("github")}><GitBranch size={14} />Import GitHub repo</button></div><div className="modal-body"><label><span>Workspace name</span><input value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} placeholder={workspaceTab === "create" ? "New website exploration" : "Defaults to repository name"} /></label>{workspaceTab === "create" ? <div className="blank-workspace-preview"><Grid2X2 size={22} /><div><strong>One independent home route</strong><span>Start with the default brand palette, then edit or add colors.</span></div></div> : <><label><span>GitHub repository URL</span><input value={repositoryUrl} onChange={(event) => setRepositoryUrl(event.target.value)} placeholder="https://github.com/owner/repository" /></label><div className="import-details"><GitBranch size={18} /><div><strong>Direct public-repository import</strong><span>We discover Next routes and read brand, token, theme, global CSS, and Tailwind files. Private repositories require the GitHub App.</span></div></div><label className="trust-check"><input type="checkbox" checked={trusted} onChange={(event) => setTrusted(event.target.checked)} /><span>I trust this repository. Dependency scripts may run only after import and a separate confirmation.</span></label>{importError && <p className="import-error">{importError}</p>}</>}</div><footer><button className="cancel" onClick={() => setWorkspaceModal(false)}>Cancel</button>{workspaceTab === "create" ? <button className="primary" onClick={createWorkspace}>Create workspace</button> : <button className="primary" disabled={!repositoryUrl || importing} onClick={() => void importWorkspace()}>{importing ? "Reading routes and brand guide…" : "Import workspace"}</button>}</footer></section></div>}
    {pageModal && <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && setPageModal(false)}><section className="workspace-modal page-modal"><header><div><span>PAGE HIERARCHY</span><h2>{resolvingGapId ? "Create the missing next state" : "Add a page"}</h2><p>Each page receives stable Navigation and Route content layers. Duplicates copy every child node and style without sharing state.</p></div><button onClick={() => setPageModal(false)}>×</button></header><div className="modal-tabs"><button className={pageMode === "duplicate" ? "active" : ""} onClick={() => setPageMode("duplicate")}><Copy size={14} />Duplicate {selectedSpec.name}</button><button className={pageMode === "blank" ? "active" : ""} onClick={() => setPageMode("blank")}><Plus size={14} />Blank hierarchy</button></div><div className="modal-body"><label><span>Page name</span><input value={pageName} onChange={(event) => setPageName(event.target.value)} /></label><label><span>Route</span><input value={pageRoute} onChange={(event) => setPageRoute(event.target.value)} placeholder="/new-page" /></label><div className="hierarchy-preview"><Layers3 size={18} /><div><strong>{pageMode === "duplicate" ? "Hierarchy and design copied" : "Standard hierarchy created"}</strong><span>Page → Navigation → 5 editable nodes<br />Page → Route content → 5 editable nodes</span></div></div>{resolvingGapId && <div className="link-preview"><Link2 size={15} />The clicked control will be linked to this new frame.</div>}</div><footer><button className="cancel" onClick={() => setPageModal(false)}>Cancel</button><button className="primary" onClick={createPage}>{pageMode === "duplicate" ? "Duplicate page" : "Create page"}</button></footer></section></div>}
  </main>;
}
