import assert from 'node:assert/strict';
import test from 'node:test';
import { readInspection } from '../lib/preview-inspection';

const sample = () => ({ generation: 'bb425bdd-3a2d-4bb7-8459-a86b7dffec2d', capturedAt: '2026-09-07T00:00:00.000Z', truncated: false, selection: null,
  layers: [{ id: 'n1', parentId: null, depth: 0, tag: 'body', label: 'body' }, { id: 'n2', parentId: 'n1', depth: 1, tag: 'h1', label: 'Heading' }] });
test('accepts bounded DOM snapshots without converting them into source authority', () => {
  const parsed = readInspection({ ...sample(), sourceHash: 'forged', sourceFile: 'app/page.tsx' });
  assert.ok(parsed); assert.equal('sourceFile' in parsed, false); assert.equal('sourceHash' in parsed, false);
});
test('rejects oversized, malformed, cyclic or duplicate layer snapshots', () => {
  assert.equal(readInspection({ ...sample(), layers: Array.from({ length: 201 }, (_, index) => ({ ...sample().layers[0], id: `n${index + 1}` })) }), null);
  assert.equal(readInspection({ ...sample(), layers: [sample().layers[1]] }), null);
  assert.equal(readInspection({ ...sample(), layers: [sample().layers[0], sample().layers[0]] }), null);
  assert.equal(readInspection({ ...sample(), layers: [{ ...sample().layers[0], tag: '<script>' }] }), null);
  assert.equal(readInspection({ ...sample(), layers: [{ ...sample().layers[0], label: 'x'.repeat(121) }] }), null);
  assert.equal(readInspection({ ...sample(), selection: { text: 'x'.repeat(2001) } }), null);
  assert.equal(readInspection({ ...sample(), generation: 'previous-page' }), null);
});
