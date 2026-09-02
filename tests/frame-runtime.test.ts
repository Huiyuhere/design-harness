import assert from "node:assert/strict";
import test from "node:test";
import { chooseLiveFrameIds, normalizeScrollSnapshot, verificationLabel } from "../lib/frame-runtime";

const frames = Array.from({ length: 8 }, (_, index) => ({ id: `frame-${index}`, sourceRouteId: `route-${index}`, x: index * 500, y: 0, width: 430, height: 300, pinned: index === 7 }));

test("keeps one to three live frames and disables them below the thumbnail zoom threshold", () => {
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.64, 3), []);
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.82, 2), ["frame-0", "frame-7"]);
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.82, 3), ["frame-0", "frame-7", "frame-1"]);
});

test("normalizes bounded scroll state and honest verification labels", () => {
  const normalized = normalizeScrollSnapshot({ windowX: -4, windowY: 120.5, capturedAt: "now", containers: [{ anchor: "main", x: 3, y: 99 }] });
  assert.equal(normalized.windowX, 0); assert.equal(normalized.windowY, 120.5); assert.equal(normalized.containers[0].anchor, "main");
  assert.equal(verificationLabel("thumbnail_stale"), "Thumbnail may be stale");
  assert.equal(verificationLabel("pixel_verified"), "Production pixel verified");
});
