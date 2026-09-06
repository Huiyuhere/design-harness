import assert from 'node:assert/strict';
import test from 'node:test';
import type { FileSystemTree } from '@webcontainer/api';
import { PreviewSession, previewCommands, type PreviewRuntime, type PreviewProcess, type PreviewStart, type LivePreviewEvent } from '../lib/preview-session';
import { validateDraft, type PreviewDraft } from '../lib/preview-drafts';
import { NEXT_ASYNC_CONTEXT_PROBE } from '../lib/preview-compatibility';
import { execFileSync } from 'node:child_process';

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tree: FileSystemTree = { 'package.json': { file: { contents: '{"scripts":{"dev":"vite"}}' } }, 'page.tsx': { file: { contents: 'original' } } };
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function until(check: () => boolean) { for (let i = 0; i < 100; i++) { if (check()) return; await tick(); } assert.fail('Expected state did not arrive'); }

function fixture(options: { contextExit?: number; install?: Promise<number>; noReady?: boolean; failSpawn?: boolean; failWrite?: string; mountGate?: Promise<void>; failSave?: boolean; download?: (input: PreviewStart, signal: AbortSignal) => Promise<FileSystemTree>; serverLimit?: number; installLimit?: number } = {}) {
  const files = new Map<string, string>(); const drafts = new Map<string, PreviewDraft>(); const mounts: string[] = []; const processes: Array<PreviewProcess & { command: string; args: string[]; killed: boolean; end(code: number): void }> = [];
  const listeners = new Set<(port: number, url: string) => void>(); const events: LivePreviewEvent[] = []; const rawWrites = new Map<string, string | Uint8Array>();
  let failWrite = options.failWrite; let saves = 0;
  const instance: PreviewRuntime = {
    async mount(input) { if (options.mountGate) await options.mountGate; const walk = (nodes: FileSystemTree, base: string) => { for (const [name, node] of Object.entries(nodes)) { const path = `${base}/${name}`; if ('directory' in node) walk(node.directory, path); else if ('file' in node && 'contents' in node.file) files.set(path, typeof node.file.contents === 'string' ? node.file.contents : new TextDecoder().decode(node.file.contents)); } }; walk(input, ''); mounts.push([...files.keys()][0]); },
    async setPreviewScript() {},
    on(_event, listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async spawn(command, args) {
      if (options.failSpawn && args[0] === 'run') throw new Error('spawn failed');
      const exit = deferred<number>();
      const p = { command, args, killed: false, exit: exit.promise, output: new ReadableStream<string>({ start(controller) { controller.close(); } }), kill() { p.killed = true; exit.resolve(143); }, end: exit.resolve };
      processes.push(p);
      if (command === 'node') exit.resolve(options.contextExit ?? 0);
      else if (args[0] !== 'run') { if (options.install) void options.install.then(exit.resolve); else exit.resolve(0); }
      else if (!options.noReady) queueMicrotask(() => { for (const listener of listeners) listener(3000, 'https://preview.example'); });
      return p;
    },
    fs: {
      async readFile(path) { if (!files.has(path)) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' }); return files.get(path)!; },
      async writeFile(path, value) { if (path.endsWith(failWrite || '\0')) { failWrite = undefined; throw new Error('disk write failed'); } rawWrites.set(path, value); files.set(path, typeof value === 'string' ? value : new TextDecoder().decode(value)); },
      async mkdir() {},
      async rm(path, flags) { for (const key of files.keys()) if (key === path || (flags.recursive && key.startsWith(`${path}/`))) files.delete(key); },
    },
  };
  const session = new PreviewSession({ boot: async () => instance, download: options.download ?? (async () => structuredClone(tree)), bridge: () => '', limits: { install: options.installLimit ?? 500, server: options.serverLimit ?? 500 }, drafts: {
    async load(key) { return structuredClone(drafts.get(key)); },
    async save(draft) { saves++; if (options.failSave) throw new Error('storage quota'); drafts.set(draft.key, structuredClone(draft)); },
  } });
  const input = (id = 'one'): PreviewStart => ({ workspaceId: id, ref: 'a'.repeat(40), repositoryUrl: 'https://github.com/example/project', trusted: true, onEvent: event => events.push(event) });
  return { session, files, drafts, processes, listeners, events, mounts, input, rawWrites, get saves() { return saves; } };
}

test('trust and safe workspace/revision required before any download', async () => {
  const f = fixture(); await assert.rejects(f.session.start({ ...f.input(), trusted: false }), /trust/);
  await assert.rejects(f.session.start({ ...f.input(), workspaceId: '../other' }), /safe workspace/);
  await assert.rejects(f.session.start({ ...f.input(), ref: 'main' }), /exact Git SHA/); assert.equal(f.mounts.length, 0);
});
test('Next App Router checks request context before transferring source or installing dependencies', async () => {
  const files: FileSystemTree = { 'package.json': { file: { contents: '{"scripts":{"dev":"next dev"},"dependencies":{"next":"16.2.10"}}' } }, app:{directory:{'page.jsx':{file:{contents:'export default()=> <h1>Page</h1>'}}}} };
  assert.equal(previewCommands(files).requiresAsyncContext, true);
  assert.equal(previewCommands({...files,app:{file:{contents:''}}}).requiresAsyncContext, false);
  assert.equal(previewCommands({'package.json':files['package.json'],src:{directory:{app:files.app}}}).requiresAsyncContext, true);
  const blocked = fixture({contextExit:78,download:async()=>files});
  await assert.rejects(blocked.session.start(blocked.input()), /Preview is unavailable/);
  assert.equal(blocked.processes.length,1);assert.equal(blocked.processes[0].command,'node');
  assert.equal(blocked.rawWrites.size,0);assert.equal(blocked.files.size,0);
  assert.equal(blocked.events.at(-1)?.status,'error');
  const compatible = fixture({download:async()=>files});
  await compatible.session.start(compatible.input());
  assert.equal(compatible.events.at(-1)?.status,'ready');
  await compatible.session.stop();
});
test('request-context compatibility probe passes with genuine native Node semantics', () => {
  assert.match(execFileSync(process.execPath,['-e',NEXT_ASYNC_CONTEXT_PROBE],{encoding:'utf8'}),/Request context supported/);
});
test('classic Yarn uses frozen-lockfile; modern Yarn immutable; no-lock npm honest', () => {
  assert.equal(previewCommands(tree).locked, false);
  assert.deepEqual(previewCommands({ ...tree, 'yarn.lock': { file: { contents: '# yarn lockfile v1' } } }).args, ['install', '--frozen-lockfile']);
  assert.deepEqual(previewCommands({ ...tree, 'yarn.lock': { file: { contents: '__metadata:\n version: 8' } } }).args, ['install', '--immutable']);
});
test('Next 16 browser adapter chooses Webpack without changing package source or custom scripts', () => {
  const pkg = '{"scripts":{"dev":"next dev"},"dependencies":{"next":"16.2.10"}}';
  const files = { 'package.json': { file: { contents: pkg } } };
  assert.deepEqual(previewCommands(files).startArgs, ['run', 'dev', '--', '--webpack']);
  assert.equal(files['package.json'].file.contents, pkg);
  assert.deepEqual(previewCommands({ ...files, 'pnpm-lock.yaml': { file: { contents: '' } } }).startArgs, ['run', 'dev', '--webpack']);
  assert.equal(previewCommands({ 'package.json': { file: { contents: pkg.replace('next dev', 'custom-server') } } }).webpack, false);
  assert.equal(previewCommands({ 'package.json': { file: { contents: pkg.replace('16.2.10', '15.2.0') } } }).webpack, false);
});
test('stop aborts download; a late download never mounts or reports ready', async () => {
  const pending = deferred<FileSystemTree>(); let signal!: AbortSignal;
  const f = fixture({ download: async (_input, nextSignal) => { signal = nextSignal; return pending.promise; } });
  const first = f.session.start(f.input()); const rejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => Boolean(signal)); await f.session.stop(); await rejected;
  pending.resolve(tree); await tick(); assert.equal(signal.aborted, true); assert.equal(f.mounts.length, 0);
});
test('switch during install kills it and cleans the previous tree before next mount', async () => {
  const install = deferred<number>(); const f = fixture({ install: install.promise });
  const first = f.session.start(f.input()); const rejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => f.processes.length === 1);
  const second = f.session.start(f.input('two')); await rejected; install.resolve(0); await second;
  assert.equal(f.processes[0].killed, true); assert.ok([...f.files.keys()].every(path => path.startsWith('/workspaces/two/')));
  await f.session.stop(); assert.equal(f.files.size, 0); assert.equal(f.listeners.size, 0);
});
test('stop waits for an in-flight mount, then removes it', async () => {
  const mount = deferred<void>(); const f = fixture({ mountGate: mount.promise });
  const first = f.session.start(f.input()); const rejected = assert.rejects(first, { name: 'AbortError' });
  await until(() => f.events.some(event => event.status === 'mounting'));
  await tick(); const stopped = f.session.stop(); mount.resolve(); await stopped; await rejected;
  assert.equal(f.files.size, 0); assert.equal(f.processes.length, 0);
});
test('installation timeout kills its process and does not leave a mounted tree', async () => {
  const f = fixture({ install: new Promise(() => {}), installLimit: 15 });
  await assert.rejects(f.session.start(f.input()), /did not finish/);
  assert.equal(f.processes[0].killed, true); assert.equal(f.files.size, 0);
});
test('server deadline and spawn rejection remove listeners and processes', async () => {
  for (const options of [{ noReady: true, serverLimit: 15 }, { failSpawn: true }]) {
    const f = fixture(options); await assert.rejects(f.session.start(f.input()));
    assert.equal(f.listeners.size, 0); assert.equal(f.files.size, 0); assert.ok(f.processes.every(p => p.args[0] !== 'run' || p.killed));
  }
});
test('a clean exit before readiness is an error, not a two-minute wait', async () => {
  const f = fixture({ noReady: true }); const started = f.session.start(f.input()); const rejected = assert.rejects(started, /stopped \(0\)/);
  await until(() => f.processes.some(p => p.args[0] === 'run')); f.processes.at(-1)!.end(0); await rejected; assert.equal(f.listeners.size, 0);
});
test('post-ready dev-server exit removes ready status and blocks source writes', async () => {
  const f = fixture(); await f.session.start(f.input()); f.processes.at(-1)!.end(1); await tick();
  assert.equal(f.events.at(-1)?.status, 'error'); assert.throws(() => f.session.apply('one', []), /no longer active/); await f.session.stop();
});
test('approved deltas survive stop/start; foreign workspace and stale source rejected', async () => {
  const f = fixture(); await f.session.start(f.input());
  assert.throws(() => f.session.read('two', 'page.tsx'), /no longer active/);
  await f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'edited' }]);
  await assert.rejects(f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'stale' }]), /Source conflict/);
  await f.session.stop(); await f.session.start(f.input()); assert.equal(await f.session.read('one', 'page.tsx'), 'edited');
  await f.session.start(f.input('two')); assert.equal(await f.session.read('two', 'page.tsx'), 'original'); await f.session.stop();
});
test('concurrent writers serialize and compare against the actual latest source', async () => {
  const f = fixture(); await f.session.start(f.input());
  const first = f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'first' }]);
  const second = f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'second' }]);
  await first; await assert.rejects(second, /Source conflict/); assert.equal(await f.session.read('one', 'page.tsx'), 'first'); await f.session.stop();
});
test('multi-file failure restores source and prior journal exactly', async () => {
  const f = fixture({ failWrite: 'new.tsx' }); await f.session.start(f.input());
  await assert.rejects(f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'edited' }, { path: 'new.tsx', before: null, after: 'new' }]), /disk write/);
  assert.equal(await f.session.read('one', 'page.tsx'), 'original'); assert.equal(f.files.has('/workspaces/one/new.tsx'), false);
  assert.deepEqual([...f.drafts.values()][0].files, []); await f.session.stop();
});
test('storage failure prevents any source write, and workflow changes are prohibited', async () => {
  const f = fixture({ failSave: true }); await f.session.start(f.input());
  await assert.rejects(f.session.apply('one', [{ path: 'page.tsx', before: 'original', after: 'edited' }]), /storage quota/);
  assert.equal(await f.session.read('one', 'page.tsx'), 'original');
  assert.throws(() => f.session.apply('one', [{ path: '.github/workflows/build.yml', before: null, after: 'x' }]), /Unsafe/); await f.session.stop();
});
test('draft rejects traversal, duplicates and excessive memory', () => {
  assert.throws(() => validateDraft({ key: 'x', files: [{ path: '../x', before: null, after: '' }] }), /Unsafe/);
  assert.throws(() => validateDraft({ key: 'x', files: [{ path: 'x', before: null, after: 'a' }, { path: 'x', before: null, after: 'b' }] }), /duplicate/);
  assert.throws(() => validateDraft({ key: 'x', files: [{ path: 'x', before: null, after: 'a'.repeat(10 * 1024 * 1024) }] }), /10 MiB/);
});
test('source punctuation and every binary byte bypass SDK tree serialization', async () => {
  const source = new TextEncoder().encode('const text = "you’re welcome — café 🌊";');
  const binary = Uint8Array.from({length:256}, (_,i)=>i);
  // Reproduce why a browser latin1 decoder is not a byte-preserving serializer.
  assert.notDeepEqual(Uint8Array.from(new TextDecoder('latin1').decode(binary), c=>c.charCodeAt(0)), binary);
  const f = fixture({download:async()=>({...tree,'page.tsx':{file:{contents:source}},'asset.png':{file:{contents:binary}}})});
  await f.session.start(f.input());
  assert.equal(await f.session.read('one','page.tsx'), new TextDecoder().decode(source));
  assert.deepEqual(f.rawWrites.get('/workspaces/one/asset.png'), binary);
  await f.session.stop();
});
