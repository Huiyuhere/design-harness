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
  return { windowX: finite(input?.windowX), windowY: finite(input?.windowY), containers, capturedAt: typeof input?.capturedAt === "string" ? input.capturedAt : "" };
}

export function chooseLiveFrameIds(frames: RuntimeFrame[], selectedId: string, zoom: number, maxLive = 2): string[] {
  if (zoom < 0.65 || maxLive < 1) return [];
  const selected = frames.find((frame) => frame.id === selectedId);
  if (!selected) return [];
  const limit = Math.max(1, Math.min(3, maxLive));
  const pinned = frames.filter((frame) => frame.pinned && frame.id !== selectedId).slice(0, Math.max(0, limit - 1));
  const chosen = [selected, ...pinned];
  if (chosen.length < limit) {
    const center = (frame: RuntimeFrame) => ({ x: frame.x + frame.width / 2, y: frame.y + frame.height / 2 });
    const origin = center(selected);
    const nearby = frames.filter((frame) => !chosen.some((item) => item.id === frame.id)).sort((a, b) => {
      const ac = center(a); const bc = center(b);
      return Math.hypot(ac.x - origin.x, ac.y - origin.y) - Math.hypot(bc.x - origin.x, bc.y - origin.y);
    });
    chosen.push(...nearby.slice(0, limit - chosen.length));
  }
  return chosen.map((frame) => frame.id);
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
