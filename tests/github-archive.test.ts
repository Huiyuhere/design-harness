import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync } from 'node:crypto';
import type { NextRequest } from 'next/server';
import { GET } from '../app/api/github/archive/route';
import { githubAppCookie, githubInstallationCookie } from '../lib/github-app';
import { MAX_ARCHIVE_BYTES } from '../lib/archive-policy';

// Only generated, synthetic credentials and repository data are used here.
const user = { userId: 'archive-test-owner', email: 'owner@example.test', displayName: 'Owner' };
const privateKey = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const sha = 'b'.repeat(40);
const origin = 'https://canvas.example.test';
type ErrorPayload = { error: string; needsGitHubApp?: boolean; retryAfter?: number };
const errorPayload = async (response: Response) => await response.json() as ErrorPayload;
async function request(signal?: AbortSignal) {
  Object.assign(process.env, { NODE_ENV: 'production' });
  process.env.API_KEY_ENCRYPTION_KEY = 'synthetic-archive-test-encryption-key-only';
  delete process.env.GITHUB_APP_ID;
  delete process.env.GITHUB_APP_SLUG;
  delete process.env.GITHUB_APP_PRIVATE_KEY;
  const app = await githubAppCookie({ appId: '123', slug: 'archive-test', privateKey, createdAt: '2026-09-07T00:00:00Z' }, user);
  const installation = await githubInstallationCookie({ installationId: 456, connectedAt: '2026-09-07T00:00:00Z' }, user);
  const value = new Request(`${origin}/api/github/archive?repositoryUrl=https%3A%2F%2Fgithub.com%2Fexample%2Ffrontend&ref=${sha}`, { signal, headers: {
    'origin': origin, 'oai-authenticated-user-id': user.userId, 'oai-authenticated-user-email': user.email,
    'cookie': [app, installation].map(cookie => cookie.split(';')[0]).join('; '),
  } });
  return Object.assign(value, { nextUrl: new URL(value.url) }) as NextRequest;
}

test('archive endpoint preserves primary/secondary rate limits without asking for reconnection', async t => {
  let archive = () => new Response('private upstream diagnostics', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '90' } });
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).endsWith('/access_tokens') ? Response.json({ token: 'synthetic-test-token' }) : archive());
  for (const response of [
    () => new Response('private upstream diagnostics', { status: 403, headers: { 'x-ratelimit-remaining': '0', 'retry-after': '90' } }),
    () => new Response('private upstream diagnostics', { status: 429, headers: { 'retry-after': '90' } }),
  ]) {
    archive = response;
    const result = await GET(await request());
    assert.equal(result.status, 429);
    assert.equal(result.headers.get('retry-after'), '90');
    const body = await errorPayload(result);
    assert.equal(body.needsGitHubApp, false);
    assert.equal(body.retryAfter, 90);
    assert.equal(body.error.includes('private upstream'), false);
  }
});

test('installation-token limits retain their status at the archive endpoint', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private token failure', { status: 429 }));
  const result = await GET(await request());
  assert.equal(result.status, 429);
  assert.equal(result.headers.get('retry-after'), '60');
  assert.equal((await errorPayload(result)).needsGitHubApp, false);
});

test('archive access failures remain distinct from service failures without reflecting upstream text', async t => {
  let status = 401;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).endsWith('/access_tokens') ? Response.json({ token: 'synthetic-test-token' }) : new Response('private upstream diagnostics', { status }));
  for (const value of [401, 403, 404, 500]) {
    status = value;
    const result = await GET(await request());
    assert.equal(result.status, status === 500 ? 502 : status);
    assert.equal(result.headers.get('cache-control'), 'private, no-store');
    const body = await errorPayload(result);
    assert.equal(body.needsGitHubApp, status !== 500);
    assert.equal(body.error.includes('private upstream'), false);
  }
});

test('archive requests stay SHA-pinned, read-only and streaming; cancellation reaches upstream', async t => {
  const controller = new AbortController();
  const deadlines: number[] = [];
  const timeout = AbortSignal.timeout.bind(AbortSignal);
  t.mock.method(AbortSignal, 'timeout', (milliseconds: number) => { deadlines.push(milliseconds); return timeout(milliseconds); });
  let signal: AbortSignal | undefined;
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input).endsWith('/access_tokens')) {
      assert.deepEqual(JSON.parse(String(init?.body)), { repositories: ['frontend'], permissions: { contents: 'read' } });
      return Response.json({ token: 'synthetic-test-token' });
    }
    assert.equal(String(input), `https://api.github.com/repos/example/frontend/zipball/${sha}`);
    assert.equal(new Headers(init?.headers).get('authorization'), 'Bearer synthetic-test-token');
    signal = init?.signal ?? undefined;
    return new Response(new ReadableStream<Uint8Array>({ pull(c) { c.enqueue(new Uint8Array([1, 2, 3])); }, cancel() { cancelled = true; } }));
  });
  const result = await GET(await request(controller.signal));
  assert.equal(result.status, 200);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(result.headers.get('content-type'), 'application/zip');
  assert.ok(signal, 'Upstream fetch must have a bounded, cancellable signal');
  assert.ok(deadlines.includes(120_000), 'Archive transfer has a two-minute upstream deadline');
  const reader = result.body!.getReader();
  assert.deepEqual((await reader.read()).value, new Uint8Array([1, 2, 3]));
  controller.abort();
  assert.equal(signal.aborted, true);
  await reader.cancel();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(cancelled, true);
});

test('oversized archive is rejected before buffering and its stream is cancelled', async t => {
  let cancelled = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => String(input).endsWith('/access_tokens') ? Response.json({ token: 'synthetic-test-token' }) : new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'content-length': String(MAX_ARCHIVE_BYTES + 1) } }));
  const result = await GET(await request());
  assert.equal(result.status, 413);
  assert.equal(result.headers.get('cache-control'), 'private, no-store');
  assert.equal(cancelled, true);
});

test('stalled archive timeout is retryable and does not expose request diagnostics', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    if (String(input).endsWith('/access_tokens')) return Response.json({ token: 'synthetic-test-token' });
    throw new DOMException('private upstream timeout details', 'TimeoutError');
  });
  const result = await GET(await request());
  assert.equal(result.status, 504);
  assert.equal((await errorPayload(result)).error.includes('private upstream'), false);
});

test('disconnected, unsigned, foreign-owner, cross-origin and invalid revision requests do not call GitHub', async t => {
  const network = t.mock.method(globalThis, 'fetch', async () => { throw new Error('Must not reach GitHub'); });
  for (const change of [
    (r: NextRequest) => { r.headers.delete('cookie'); },
    (r: NextRequest) => { r.headers.delete('oai-authenticated-user-id'); },
    (r: NextRequest) => { r.headers.set('oai-authenticated-user-id', 'foreign-owner'); },
    (r: NextRequest) => { r.headers.set('origin', 'https://evil.example'); },
    (r: NextRequest) => { r.nextUrl.searchParams.set('ref', 'main'); },
  ]) {
    const r = await request(); change(r);
    const result = await GET(r);
    assert.ok([400, 401, 403, 409].includes(result.status));
  }
  assert.equal(network.mock.callCount(), 0);
});
