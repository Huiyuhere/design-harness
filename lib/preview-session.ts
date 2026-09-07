import type { FileSystemTree } from '@webcontainer/api';
import { safeRepositoryPath } from './archive-policy';
import { validateDraft, type PreviewDraft, type PreviewDraftStore, type SourceChange } from './preview-drafts';
import { NEXT_ASYNC_CONTEXT_PROBE, NEXT_CONTEXT_ERROR } from './preview-compatibility';
import { PREVIEW_TOOL_DIRECTORY, VITE_PREVIEW_CONFIG } from './preview-source-tools';

export type LivePreviewStatus = 'idle' | 'downloading' | 'mounting' | 'installing' | 'starting' | 'ready' | 'error';
export type LivePreviewEvent = { status: LivePreviewStatus; message: string; url?: string };
export type PreviewProcess = { kill(): void; exit: Promise<number>; output: ReadableStream<string> };
export type PreviewRuntime = {
  mount(tree: FileSystemTree): Promise<void>;
  setPreviewScript(source: string): Promise<void>;
  spawn(command: string, args: string[], options: { cwd: string }): Promise<PreviewProcess>;
  on(event: 'server-ready', listener: (port: number, url: string) => void): () => void;
  fs: {
    rm(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
    readFile(path: string, encoding: 'utf-8'): Promise<string>;
    writeFile(path: string, text: string | Uint8Array): Promise<void>;
  };
};
export type PreviewStart = {
  workspaceId: string; repositoryUrl: string; ref: string; trusted: boolean;
  onEvent: (event: LivePreviewEvent) => void;
};
type Session = {
  input: PreviewStart; controller: AbortController; processes: Set<PreviewProcess>;
  cleanup: Set<() => void>; instance?: PreviewRuntime; mounted: boolean; ready: boolean;
  draft: PreviewDraft;
  log: string;
};
type Dependencies = {
  boot(): Promise<PreviewRuntime>;
  download(input: PreviewStart, signal: AbortSignal): Promise<FileSystemTree>;
  bridge(): string; drafts: PreviewDraftStore;
  sourceTool?(signal: AbortSignal): Promise<string>;
  limits?: { download?: number; install?: number; server?: number; validation?:number };
};
const cancelled = () => new DOMException('Preview stopped or workspace changed.', 'AbortError');
// Strip terminal control sequences before putting process diagnostics in the UI.
// eslint-disable-next-line no-control-regex
const terminalText = (log: string) => log.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').slice(-900);

export function previewCommands(files: FileSystemTree) {
  const raw = files['package.json'];
  if (!raw || !('file' in raw) || !('contents' in raw.file)) throw new Error('Missing package.json.');
  const pkg = JSON.parse(typeof raw.file.contents === 'string' ? raw.file.contents : new TextDecoder().decode(raw.file.contents));
  if (typeof pkg.scripts?.dev !== 'string' || !pkg.scripts.dev.trim()) throw new Error('This repository needs a dev script before it can run.');
  const manager = files['pnpm-lock.yaml'] ? 'pnpm' : files['yarn.lock'] ? 'yarn' : 'npm';
  const yarn = files['yarn.lock'];
  const lock = yarn && 'file' in yarn && 'contents' in yarn.file ? yarn.file.contents : '';
  const yarnText = typeof lock === 'string' ? lock : new TextDecoder().decode(lock);
  const locked = manager !== 'npm' || Boolean(files['package-lock.json']);
  const args = manager === 'pnpm' ? ['install', '--frozen-lockfile'] : manager === 'yarn' ? ['install', /__metadata:/.test(yarnText) ? '--immutable' : '--frozen-lockfile'] : locked ? ['ci'] : ['install'];
  // Next 16 defaults to a native-only bundler. For the uncustomized dev command,
  // use its documented Webpack option in the WASM runtime, without editing source.
  const nextVersion = String(pkg.dependencies?.next ?? pkg.devDependencies?.next ?? '');
  const nextMajor = Number(nextVersion.match(/^[~^]?(\d+)/)?.[1]);
  const webpack = pkg.scripts.dev.trim() === 'next dev' && nextMajor >= 16;
  const src = files.src;
  const requiresAsyncContext = nextMajor >= 16 && Boolean(files.app && 'directory' in files.app || src && 'directory' in src && src.directory.app && 'directory' in src.directory.app);
  const startArgs = ['run', 'dev', ...(webpack ? (manager === 'npm' ? ['--', '--webpack'] : ['--webpack']) : [])];
  return { manager, locked, args, webpack, startArgs, requiresAsyncContext, sourceMapping: pkg.scripts.dev.trim() === 'vite' };
}

/** One serialized lifecycle. Late completions can never mount/write the next repository. */
export class PreviewSession {
  private current: Session | null = null;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private deps: Dependencies) {}
  private serial<T>(run: () => Promise<T>) {
    const result = this.tail.then(run); this.tail = result.catch(() => undefined); return result;
  }
  private assert(session: Session) {
    if (this.current !== session || session.controller.signal.aborted) throw cancelled();
  }
  private emit(session: Session, event: LivePreviewEvent) {
    if (this.current === session && !session.controller.signal.aborted) session.input.onEvent(event);
  }
  private cancel(session: Session) {
    session.controller.abort(); session.ready = false;
    for (const cleanup of session.cleanup) cleanup(); session.cleanup.clear();
    for (const process of session.processes) process.kill();
  }
  private async cleanup(session: Session) {
    this.cancel(session);
    if (session.instance && session.mounted) {
      await session.instance.fs.rm(`/workspaces/${session.input.workspaceId}`, { recursive: true, force: true });
      session.mounted = false;
    }
  }
  start(input: PreviewStart) {
    if (!input.trusted) return Promise.reject(new Error('Confirm repository script trust before starting.'));
    if (!/^[a-zA-Z0-9_-]{1,120}$/.test(input.workspaceId) || !/^[a-f0-9]{40}$/i.test(input.ref)) return Promise.reject(new Error('A safe workspace ID and exact Git SHA are required.'));
    const prior = this.current;
    if (prior) this.cancel(prior);
    const session: Session = { input, controller: new AbortController(), processes: new Set(), cleanup: new Set(), mounted: false, ready: false,
      draft: { key: JSON.stringify([input.workspaceId, input.repositoryUrl, input.ref]), files: [] }, log: '' };
    this.current = session;
    return this.serial(async () => {
      try {
        if (prior) await this.cleanup(prior);
        this.assert(session);
        this.emit(session, { status: 'downloading', message: 'Downloading the approved repository…' });
        let files = await this.bounded(session, this.deps.download(input, session.controller.signal), this.deps.limits?.download ?? 120_000, 'Repository download timed out.');
        this.assert(session);
        let commands = previewCommands(files);
        // Never replace an imported directory, even if it uses our reserved name.
        const sourceToolCollision = Boolean(files[PREVIEW_TOOL_DIRECTORY]);
        this.emit(session, { status: 'mounting', message: 'Opening the repository…' });
        session.instance = await this.deps.boot(); this.assert(session);
        // API 1.6.1 tree.mount serializes Uint8Array through TextDecoder('latin1'),
        // which maps bytes 0x80–0x9f to Windows-1252 characters. That corrupts
        // UTF-8 source and binary assets on roundtrip. Mount directories only;
        // fs.writeFile transfers each bounded byte buffer directly, sequentially.
        session.mounted = true;
        await session.instance.mount({ workspaces: { directory: { [input.workspaceId]: { directory: {} } } } });
        this.assert(session);
        if (commands.requiresAsyncContext) {
          this.emit(session, { status: 'mounting', message: 'Checking Next.js runtime compatibility…' });
          try { await this.command(session, 'node', ['-e', NEXT_ASYNC_CONTEXT_PROBE], 10_000); }
          catch (error) {
            if (error instanceof Error && error.message.startsWith('node failed (78)')) throw new Error(NEXT_CONTEXT_ERROR, { cause: error });
            throw error;
          }
        }
        const upload = async (nodes: FileSystemTree, parent: string) => {
          for (const [name, node] of Object.entries(nodes)) {
            this.assert(session); const path = `${parent}/${name}`;
            if ('directory' in node) { await session.instance!.fs.mkdir(path, { recursive: true }); await upload(node.directory, path); }
            else if ('file' in node && 'contents' in node.file) await session.instance!.fs.writeFile(path, node.file.contents);
            else throw new Error('Unsupported source file type.');
          }
        };
        await upload(files, `/workspaces/${input.workspaceId}`); this.assert(session);
        // Retain only manifest/lock metadata while dependency installation runs.
        files = Object.fromEntries(Object.entries(files).filter(([path]) => ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(path)));
        const saved = await this.deps.drafts.load(session.draft.key); this.assert(session);
        if (saved) {
          validateDraft(saved);
          if (saved.key !== session.draft.key) throw new Error('Saved draft belongs to a different repository revision.');
          await this.checkBefore(session, saved.files);
          for (const file of saved.files) await this.put(session, file.path, file.after);
          session.draft = saved;
          const packageChange = saved.files.find(file => file.path === 'package.json');
          if (packageChange) commands = previewCommands({ ...files, 'package.json': { file: { contents: packageChange.after } } });
        }
        this.assert(session);
        if (commands.sourceMapping && this.deps.sourceTool && !sourceToolCollision) {
          const tool = await this.bounded(session, this.deps.sourceTool(session.controller.signal), 30_000, 'Preview source tools did not load. Retry the preview.');
          this.assert(session);
          if (!tool || new TextEncoder().encode(tool).byteLength > 2 * 1024 * 1024) throw new Error('Invalid preview source tool bundle.');
          const directory = `/workspaces/${input.workspaceId}/${PREVIEW_TOOL_DIRECTORY}`;
          await session.instance.fs.mkdir(directory, { recursive:true }); this.assert(session);
          await session.instance.fs.writeFile(`${directory}/source-plugin.mjs`, tool); this.assert(session);
          await session.instance.fs.writeFile(`${directory}/vite.config.mjs`, VITE_PREVIEW_CONFIG); this.assert(session);
          // Preserve the repository's own dev script, config, plugins and hooks.
          commands.startArgs = ['run','dev', ...(commands.manager === 'npm' ? ['--'] : []), '--config', `${PREVIEW_TOOL_DIRECTORY}/vite.config.mjs`];
        }
        await session.instance.setPreviewScript(this.deps.bridge()); this.assert(session);
        if (commands.manager !== 'npm') await this.command(session, 'corepack', ['enable'], 30_000);
        this.emit(session, { status: 'installing', message: commands.locked ? 'Installing locked dependencies…' : 'Installing dependencies · no lockfile in this repository' });
        await this.command(session, commands.manager, commands.args, this.deps.limits?.install ?? 300_000);
        this.emit(session, { status: 'starting', message: commands.webpack ? 'Starting Next.js with Webpack · browser compatibility' : 'Starting the page server…' });
        const url = await this.server(session, commands.manager, commands.startArgs);
        if (!session.processes.size) throw new Error('Page server exited during startup.');
        this.assert(session); session.ready = true;
        this.emit(session, { status: 'ready', message: 'Page server ready.', url }); return url;
      } catch (error) {
        this.emit(session, { status: 'error', message: (error as Error).message });
        await this.cleanup(session);
        throw error;
      }
    });
  }
  stop() {
    const session = this.current; this.current = null;
    if (session) this.cancel(session);
    return this.serial(async () => { if (session) await this.cleanup(session); });
  }
  private async spawn(session: Session, command: string, args: string[]) {
    this.assert(session);
    const process = await session.instance!.spawn(command, args, { cwd: `/workspaces/${session.input.workspaceId}` });
    if (this.current !== session || session.controller.signal.aborted) { process.kill(); throw cancelled(); }
    session.processes.add(process);
    void process.exit.then(() => session.processes.delete(process), () => session.processes.delete(process));
    return process;
  }
  private bounded<T>(session: Session, task: Promise<T>, ms: number, message: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const signal = session.controller.signal;
      const abort = () => finish(() => reject(cancelled()));
      const timer = setTimeout(() => { finish(() => reject(new Error(message))); session.controller.abort(); for (const p of session.processes) p.kill(); }, ms);
      let settled = false;
      const finish = (action: () => void) => { if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); action(); };
      signal.addEventListener('abort', abort, { once: true });
      task.then(value => finish(() => resolve(value)), error => finish(() => reject(error)));
      if (signal.aborted) abort();
    });
  }
  private async command(session: Session, command: string, args: string[], timeout: number) {
    const process = await this.spawn(session, command, args); let log = '';
    void process.output.pipeTo(new WritableStream({ write: chunk => { log = (log + chunk).slice(-2000); session.log = log; } })).catch(() => undefined);
    const code = await this.bounded(session, process.exit, timeout, `${command} did not finish in time. Retry or inspect repository scripts.`);
    this.assert(session);
    if (code !== 0) throw new Error(`${command} failed (${code}). ${terminalText(log)}`);
  }
  private async server(session: Session, manager: string, args: string[]) {
    let log = ''; let ready = false;
    let rejectReady: (reason: Error) => void = () => undefined;
    const readiness = new Promise<string>((resolve, reject) => {
      rejectReady = reject;
      const unsubscribe = session.instance!.on('server-ready', (_port, url) => {
        if (this.current !== session || session.controller.signal.aborted) return;
        ready = true; unsubscribe(); session.cleanup.delete(unsubscribe); resolve(url);
      });
      session.cleanup.add(unsubscribe);
    });
    // Attach rejection handling immediately, including when spawn itself fails.
    const waiting = this.bounded(session, readiness, this.deps.limits?.server ?? 120_000, 'Page server did not become ready within two minutes.');
    void waiting.catch(() => undefined);
    try {
      const process = await this.spawn(session, manager, args);
      void process.output.pipeTo(new WritableStream({ write: chunk => { log = (log + chunk).slice(-2000); session.log = log; } })).catch(() => undefined);
      void process.exit.then(code => {
        const error = new Error(`Page server stopped (${code}). ${terminalText(log)}`);
        if (!ready) rejectReady(error);
        else { session.ready = false; this.emit(session, { status: 'error', message: error.message }); }
      }, error => rejectReady(error));
      return await waiting;
    } catch (error) { rejectReady(error as Error); throw error; }
    finally { for (const cleanup of session.cleanup) cleanup(); session.cleanup.clear(); }
  }
  private requireReady(workspaceId: string) {
    const session = this.current;
    if (!session || !session.ready || session.input.workspaceId !== workspaceId || session.controller.signal.aborted) throw new Error('This repository preview is no longer active. Reopen it before changing source.');
    return session;
  }
  diagnostics(workspaceId: string) {
    const session = this.current;
    if (!session || session.input.workspaceId !== workspaceId) return null;
    return { ready: session.ready, processes: session.processes.size, log: session.log };
  }
  read(workspaceId: string, path: string) {
    safeRepositoryPath(path); const session = this.requireReady(workspaceId);
    return this.serial(async () => { this.assert(session); return session.instance!.fs.readFile(`/workspaces/${workspaceId}/${path}`, 'utf-8'); });
  }
  private async currentText(session: Session, path: string) {
    try { return await session.instance!.fs.readFile(`/workspaces/${session.input.workspaceId}/${path}`, 'utf-8'); }
    catch (error) { if ((error as { code?: string }).code === 'ENOENT' || /ENOENT/.test(String(error))) return null; throw error; }
  }
  private async checkBefore(session: Session, changes: SourceChange[]) {
    for (const file of changes) if (await this.currentText(session, file.path) !== file.before) throw new Error(`Source conflict in ${file.path}. Reload and review; no patch was applied.`);
  }
  private async put(session: Session, path: string, text: string | null) {
    const full = `/workspaces/${session.input.workspaceId}/${path}`;
    if (text === null) return session.instance!.fs.rm(full, { force: true });
    await session.instance!.fs.mkdir(full.slice(0, full.lastIndexOf('/')), { recursive: true });
    await session.instance!.fs.writeFile(full, text);
  }
  apply(workspaceId: string, changes: SourceChange[], validate?: (signal: AbortSignal) => Promise<void>) {
    const session = this.requireReady(workspaceId);
    validateDraft({ key: session.draft.key, files: changes });
    return this.serial(async () => {
      this.assert(session); await this.checkBefore(session, changes); this.assert(session);
      const prior = session.draft;
      const files = new Map(prior.files.map(file => [file.path, file]));
      for (const change of changes) files.set(change.path, { ...change, before: files.has(change.path) ? files.get(change.path)!.before : change.before });
      const next = validateDraft({ key: prior.key, files: [...files.values()].filter(file => file.before !== file.after) });
      // Journal first: browser crash/teardown cannot silently lose an approved edit.
      await this.deps.drafts.save(next);
      const written: SourceChange[] = [];
      try {
        for (const change of changes) { written.push(change); await this.put(session, change.path, change.after); }
        if (validate) await this.bounded(session, validate(session.controller.signal), this.deps.limits?.validation ?? 20_000, 'Render validation did not finish.');
        this.assert(session);
        session.draft = next;
      } catch (error) {
        try {
          // All-or-nothing preflight: never overwrite a newer, external change.
          for (const change of written) { const text=await this.currentText(session,change.path); if (text !== change.after && text !== change.before) throw new Error('A newer source change or partial write prevents safe rollback.'); }
          for (const change of [...written].reverse()) await this.put(session, change.path, change.before);
          await this.deps.drafts.save(prior);
        }
        catch { session.ready = false; throw new Error('The edit could not be safely restored. Newer source was preserved. Stop editing and recover or export the draft before reloading.'); }
        throw error;
      }
    });
  }
}
