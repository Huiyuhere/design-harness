export const RESPONSIVE_PROFILES = {
  desktop: { label: "Desktop", width: 1440, height: 900, orientation: "landscape" },
  tablet: { label: "Tablet", width: 768, height: 1024, orientation: "portrait" },
  mobile: { label: "Mobile", width: 390, height: 844, orientation: "portrait" },
} as const;

export type ResponsiveProfile = keyof typeof RESPONSIVE_PROFILES;
export type PreviewRepresentation = "live" | "thumbnail" | "focus";
export type VerificationState = "source_synchronized" | "thumbnail_stale" | "pixel_verified" | "not_verified" | "verification_unavailable";

export type ScrollContainerSnapshot = { anchor: string; x: number; y: number };
export type ScrollSnapshot = { windowX: number; windowY: number; containers: ScrollContainerSnapshot[]; capturedAt: string };

export type RuntimeFrame = {
  id: string;
  sourceRouteId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  pinned?: boolean;
};

export const EMPTY_SCROLL: ScrollSnapshot = { windowX: 0, windowY: 0, containers: [], capturedAt: "" };

export function normalizeScrollSnapshot(input: Partial<ScrollSnapshot> | null | undefined): ScrollSnapshot {
  const finite = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
  const containers = Array.isArray(input?.containers) ? input.containers.slice(0, 20).flatMap((item) => {
    if (!item || typeof item.anchor !== "string" || !item.anchor.trim()) return [];
    return [{ anchor: item.anchor.slice(0, 500), x: finite(item.x), y: finite(item.y) }];
  }) : [];
  return { windowX: finite(input?.windowX), windowY: finite(input?.windowY), containers, capturedAt: typeof input?.capturedAt === "string" ? input.capturedAt.slice(0, 64) : "" };
}

export function chooseLiveFrameIds(frames: RuntimeFrame[], selectedId: string, zoom: number, maxLive = 1): string[] {
  if (!Number.isFinite(zoom) || !Number.isFinite(maxLive) || zoom < 0.65 || maxLive < 1) return [];
  const selected = frames.find((frame) => frame.id === selectedId);
  if (!selected) return [];
  const limit = Math.max(1, Math.min(3, Math.floor(maxLive)));
  const pinned = frames.filter((frame) => frame.pinned && frame.id !== selectedId).slice(0, Math.max(0, limit - 1));
  const chosen = [selected, ...pinned];
  // Comparison frames require explicit pinning; being nearby is not consent
  // to mount another copy of an imported React application's client state.
  return chosen.map((frame) => frame.id);
}

export function scheduleFrameSurfaces(frames: RuntimeFrame[], selectedId: string, zoom: number, focusId: string | null, maxLive = 1) {
  // Focus replaces the canvas instances. It is not an extra fourth renderer.
  const focused = focusId && frames.some(frame => frame.id === focusId) ? focusId : null;
  return focused ? { canvas: [] as string[], focus: focused, total: 1 } : (() => {
    const canvas = chooseLiveFrameIds(frames, selectedId, zoom, maxLive);
    return { canvas, focus: null, total: canvas.length };
  })();
}

export function previewFrameUrl(baseUrl: string, route: string, frameId: string) {
  const base = new URL(baseUrl);
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid preview origin.');
  const url = new URL(route, base.origin);
  if (!route.startsWith('/') || url.origin !== base.origin) throw new Error('A frame must stay within its repository preview.');
  url.searchParams.set('__ah_frame', frameId);
  // Scroll is a message, not a URL parameter: otherwise each save reloads React.
  url.searchParams.delete('__ah_scroll_y');
  return url.toString();
}

export function verificationLabel(state: VerificationState) {
  switch (state) {
    case "source_synchronized": return "Live source synchronized";
    case "thumbnail_stale": return "Thumbnail may be stale";
    case "pixel_verified": return "Production pixel verified";
    case "verification_unavailable": return "Production verification unavailable";
    default: return "Not verified";
  }
}

export function responsiveFrameId(routeId: string, profile: ResponsiveProfile) {
  return `${routeId}--${profile}`;
}
