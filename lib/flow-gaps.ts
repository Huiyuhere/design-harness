import { TextNodeKey } from "./design-hierarchy";

export type FlowGap = {
  id: string; frameId: string; node: TextNodeKey; label: string; firstSeenAt: string; lastClickedAt: string; clickCount: number; suggestedRoute: string; status: "open" | "resolved";
  role?: string; sourceAnchor?: { route: string; group: string; node: string }; computedStyle?: { fontSize: string; color: string; fontFamily: string }; screenshotKey?: string | null; transactionId?: string | null;
};

export function recordFlowGap(gaps: FlowGap[], input: Omit<FlowGap, "id" | "clickCount" | "status" | "firstSeenAt"> & { id: string }) {
  const existing = gaps.find((gap) => gap.frameId === input.frameId && gap.node === input.node && gap.status === "open");
  if (existing) return gaps.map((gap) => gap.id === existing.id ? { ...gap, label: input.label, lastClickedAt: input.lastClickedAt, clickCount: gap.clickCount + 1 } : gap);
  return [...gaps, { ...input, firstSeenAt: input.lastClickedAt, clickCount: 1, status: "open" as const }];
}

export function resolveFlowGap(gaps: FlowGap[], gapId: string) {
  return gaps.map((gap) => gap.id === gapId ? { ...gap, status: "resolved" as const } : gap);
}

export function flowGapPrompt(gap: FlowGap, frameName: string, projectName: string) {
  return `Build the missing “${gap.label}” experience for ${projectName}. It is a ${gap.role ?? "control"} on the ${frameName} frame with no destination. Create the minimum useful route or state at ${gap.suggestedRoute}, connect this control to it, and inherit the current brand, page hierarchy, typography, colors, spacing, and reusable components. Make conservative assumptions and produce an executable page-and-route patch for my approval instead of stopping at a plan.`;
}
