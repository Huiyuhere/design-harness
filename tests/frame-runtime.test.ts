import assert from "node:assert/strict";
import test from "node:test";
import { chooseLiveFrameIds, normalizeScrollSnapshot, verificationLabel, scheduleFrameSurfaces, previewFrameUrl } from "../lib/frame-runtime";

const frames = Array.from({ length: 8 }, (_, index) => ({ id: `frame-${index}`, sourceRouteId: `route-${index}`, x: index * 500, y: 0, width: 430, height: 300, pinned: index === 7 }));

test("keeps one to three live frames and disables them below the thumbnail zoom threshold", () => {
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.64, 3), []);
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.82, 2), ["frame-0", "frame-7"]);
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.82, 3), ["frame-0", "frame-7"]);
  assert.deepEqual(chooseLiveFrameIds(frames, "frame-0", 0.82), ["frame-0"]);
});

test('90 route variants still mount at most three; focus replaces rather than adds instances', () => {
  const many = Array.from({length:90}, (_, i) => ({id:`frame-${i}`,sourceRouteId:`route-${i%30}`,x:0,y:0,width:430,height:300,pinned:true}));
  assert.equal(scheduleFrameSurfaces(many,'frame-0',1,null,3).total,3);
  assert.deepEqual(scheduleFrameSurfaces(many,'frame-0',.4,'frame-5',3),{canvas:[],focus:'frame-5',total:1});
  assert.equal(scheduleFrameSurfaces(many,'frame-0',.4,null,3).total,0);
  assert.equal(scheduleFrameSurfaces(many,'frame-0',1,'deleted',3).total,3);
  assert.deepEqual(chooseLiveFrameIds(many,'frame-0',NaN,3),[]);
  assert.deepEqual(chooseLiveFrameIds(many,'frame-0',1,Infinity),[]);
});

test('frame URL preserves fixture parameters but never contains saved scroll', () => {
  assert.equal(previewFrameUrl('https://preview.example','/welcome?step=2&__ah_scroll_y=700','mobile'), 'https://preview.example/welcome?step=2&__ah_frame=mobile');
  assert.throws(()=>previewFrameUrl('https://preview.example','//attacker.example','mobile'));
  assert.throws(()=>previewFrameUrl('https://preview.example','https://attacker.example','mobile'));
  assert.throws(()=>previewFrameUrl('javascript:alert(1)','/','mobile'));
});

test("normalizes bounded scroll state and honest verification labels", () => {
  const normalized = normalizeScrollSnapshot({ windowX: -4, windowY: 120.5, capturedAt: "now", containers: [{ anchor: "main", x: 3, y: 99 }] });
  assert.equal(normalized.windowX, 0); assert.equal(normalized.windowY, 120.5); assert.equal(normalized.containers[0].anchor, "main");
  assert.equal(verificationLabel("thumbnail_stale"), "Thumbnail may be stale");
  assert.equal(verificationLabel("pixel_verified"), "Production pixel verified");
});
