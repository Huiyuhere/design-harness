import assert from 'node:assert/strict';
import test from 'node:test';
import { Script } from 'node:vm';
import { buildPreviewBridge } from '../lib/preview-bridge';

test('preview instrumentation is standalone JavaScript with an exact parent origin', () => {
  const source = buildPreviewBridge('https://design.example');
  assert.doesNotThrow(() => new Script(source));
  assert.match(source, /event.source !== parent/);
  assert.match(source, /event.origin !== expectedOrigin/);
  assert.match(source, /const expectedOrigin = "https:\/\/design.example"/);
  assert.doesNotMatch(source, /document.referrer|__ah_scroll_y/);
  assert.throws(() => buildPreviewBridge('javascript:alert(1)'));
  assert.throws(() => buildPreviewBridge('https://design.example/path'));
});
