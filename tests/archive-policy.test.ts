import assert from 'node:assert/strict';
import test from 'node:test';
import { zipSync, strToU8 } from 'fflate';
import { boundedStream, safeRepositoryPath, MAX_FILE_BYTES } from '../lib/archive-policy';
import { repositoryArchiveToTree } from '../lib/live-preview-client';

test('archive validates paths and uncompressed sizes before inflation', () => {
  for (const path of ['../x','/tmp/a','a/../../b','a\\b','constructor/x','__proto__/x']) assert.throws(()=>safeRepositoryPath(path));
  assert.throws(()=>repositoryArchiveToTree(zipSync({'root/package.json':strToU8('{}'),'root/bomb':new Uint8Array(MAX_FILE_BYTES+1)})),/16 MiB/);
  assert.throws(()=>repositoryArchiveToTree(zipSync({'root/package.json':strToU8('{}'),'root/__proto__/polluted':strToU8('no')})),/Unsafe/);
});

test('retains binary assets byte-for-byte and omits nested generated directories', () => {
  const bytes = new Uint8Array([0,255,128,195,192,0]);
  const tree = repositoryArchiveToTree(zipSync({'root/package.json':strToU8('{}'),'root/video.mp4':bytes,'root/pkg/node_modules/a.js':bytes}));
  assert.deepEqual((tree['video.mp4'] as {file:{contents:Uint8Array}}).file.contents,bytes);
  assert.equal(tree.pkg,undefined);
});

test('Worker streaming enforces actual bytes and propagates cancellation', async () => {
  const bounded = boundedStream(new ReadableStream({start(c){c.enqueue(new Uint8Array(4));c.enqueue(new Uint8Array(4));c.close();}}),5);
  await assert.rejects(()=>new Response(bounded).arrayBuffer(),/transfer limit/);
  const allowed = boundedStream(new ReadableStream({start(c){c.enqueue(new Uint8Array([1,2,3]));c.close();}}),5);
  assert.deepEqual(new Uint8Array(await new Response(allowed).arrayBuffer()),new Uint8Array([1,2,3]));
});
