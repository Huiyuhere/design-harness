import { readCookie } from "./api-key-session";
import type { RequestUser } from "./request-security";

export const GITHUB_STATE_COOKIE = "design_harness_github_state";
export const GITHUB_INSTALLATION_COOKIE = "design_harness_github_installation";
export const GITHUB_APP_COOKIE = "design_harness_github_app";

type GitHubState = { state: string; expiresAt: number };
export type GitHubInstallationSession = { installationId: number; connectedAt: string };
export type GitHubAppConfiguration = { appId: string; slug: string; privateKey: string; createdAt: string };

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decodeBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

async function aesKey(secret: string) {
  if (secret.length < 24) throw new Error("API_KEY_ENCRYPTION_KEY must contain at least 24 characters.");
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`github-app:${secret}`));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function seal(value: unknown, userId: string, purpose: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: encoder.encode(`${purpose}:${userId}`) },
    await aesKey(secret),
    encoder.encode(JSON.stringify(value)),
  );
  return `v1.${base64Url(iv)}.${base64Url(new Uint8Array(encrypted))}`;
}

async function unseal<T>(value: string, userId: string, purpose: string, secret: string): Promise<T | null> {
  try {
    const [version, iv, payload] = value.split(".");
    if (version !== "v1" || !iv || !payload) return null;
    const decrypted = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: decodeBase64Url(iv), additionalData: encoder.encode(`${purpose}:${userId}`) },
      await aesKey(secret),
      decodeBase64Url(payload),
    );
    return JSON.parse(decoder.decode(decrypted)) as T;
  } catch {
    return null;
  }
}

export function githubAppConfigured() {
  return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_SLUG && process.env.GITHUB_APP_PRIVATE_KEY && process.env.API_KEY_ENCRYPTION_KEY);
}

function environmentConfiguration(): GitHubAppConfiguration | null {
  const appId = process.env.GITHUB_APP_ID;
  const slug = process.env.GITHUB_APP_SLUG;
  const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
  if (!appId || !slug || !privateKey) return null;
  return { appId, slug, privateKey, createdAt: "deployment" };
}

export async function githubAppCookie(configuration: GitHubAppConfiguration, user: RequestUser) {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) throw new Error("Secure GitHub App sessions are not configured.");
  return cookie(GITHUB_APP_COOKIE, await seal(configuration, user.userId, "app-configuration", secret), 30 * 24 * 60 * 60, "Strict");
}

export async function githubAppFromRequest(request: Pick<Request, "headers">, user: RequestUser) {
  const environment = environmentConfiguration();
  if (environment) return environment;
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  const value = readCookie(request.headers.get("cookie"), GITHUB_APP_COOKIE);
  if (!secret || !value) return null;
  const configuration = await unseal<GitHubAppConfiguration>(value, user.userId, "app-configuration", secret);
  if (!configuration || !/^\d+$/.test(configuration.appId) || !/^[a-z0-9-]{1,100}$/.test(configuration.slug) || !configuration.privateKey.includes("PRIVATE KEY")) return null;
  return configuration;
}

export function githubManifest(origin: string, user: RequestUser, state?: string) {
  const ownerHint = user.displayName.replace(/[^A-Za-z0-9 ]/g, "").trim().slice(0, 30) || "Designer";
  const ownerId = user.userId.replace(/[^A-Za-z0-9]/g, "").slice(-8) || "personal";
  return {
    name: `Design Harness — ${ownerHint} ${ownerId}`,
    url: origin,
    redirect_url: `${origin}/api/github/manifest/callback${state ? `?state=${encodeURIComponent(state)}` : ""}`,
    setup_url: `${origin}/api/github/callback`,
    description: "Repository-scoped source import and approved design pull requests for Design Harness.",
    public: false,
    default_events: [] as string[],
    default_permissions: { contents: "write", pull_requests: "write" },
    request_oauth_on_install: false,
  };
}

export async function githubState(user: RequestUser) {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) throw new Error("Secure GitHub App sessions are not configured.");
  const state = base64Url(crypto.getRandomValues(new Uint8Array(24)));
  const value = await seal({ state, expiresAt: Date.now() + 10 * 60_000 } satisfies GitHubState, user.userId, "install-state", secret);
  return { state, cookie: cookie(GITHUB_STATE_COOKIE, value, 600, "Lax") };
}

export async function verifyGitHubState(request: Pick<Request, "headers">, user: RequestUser, providedState: string) {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  const value = readCookie(request.headers.get("cookie"), GITHUB_STATE_COOKIE);
  if (!secret || !value) return false;
  const session = await unseal<GitHubState>(value, user.userId, "install-state", secret);
  return Boolean(session && session.state === providedState && session.expiresAt > Date.now());
}

export async function githubInstallationCookie(session: GitHubInstallationSession, user: RequestUser) {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  if (!secret) throw new Error("Secure GitHub App sessions are not configured.");
  return cookie(GITHUB_INSTALLATION_COOKIE, await seal(session, user.userId, "installation", secret), 30 * 24 * 60 * 60, "Strict");
}

export async function githubInstallationFromRequest(request: Pick<Request, "headers">, user: RequestUser) {
  const secret = process.env.API_KEY_ENCRYPTION_KEY;
  const value = readCookie(request.headers.get("cookie"), GITHUB_INSTALLATION_COOKIE);
  if (!secret || !value) return null;
  const session = await unseal<GitHubInstallationSession>(value, user.userId, "installation", secret);
  if (!session || !Number.isSafeInteger(session.installationId) || session.installationId < 1) return null;
  return session;
}

function cookie(name: string, value: string, maxAge: number, sameSite: "Lax" | "Strict") {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=${sameSite}${secure}; Max-Age=${maxAge}`;
}

export function clearGitHubCookie(name = GITHUB_INSTALLATION_COOKIE) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${name}=; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=0`;
}

function derLength(length: number) {
  if (length < 128) return new Uint8Array([length]);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return new Uint8Array([0x80 | bytes.length, ...bytes]);
}

function joinBytes(...parts: Uint8Array[]) {
  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}

function der(tag: number, body: Uint8Array) {
  return joinBytes(new Uint8Array([tag]), derLength(body.length), body);
}

function pemBytes(pem: string) {
  const normalized = pem.replace(/\\n/g, "\n");
  const isPkcs1 = normalized.includes("BEGIN RSA PRIVATE KEY");
  const body = normalized.replace(/-----BEGIN [^-]+-----|-----END [^-]+-----|\s/g, "");
  const decoded = Uint8Array.from(atob(body), (character) => character.charCodeAt(0));
  if (!isPkcs1) return decoded;
  const rsaAlgorithm = new Uint8Array([0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00]);
  return der(0x30, joinBytes(new Uint8Array([0x02, 0x01, 0x00]), rsaAlgorithm, der(0x04, decoded)));
}

async function appJwt(configuration: GitHubAppConfiguration) {
  const key = await crypto.subtle.importKey("pkcs8", pemBytes(configuration.privateKey), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(encoder.encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const payload = base64Url(encoder.encode(JSON.stringify({ iat: now - 60, exp: now + 9 * 60, iss: configuration.appId })));
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoder.encode(`${header}.${payload}`));
  return `${header}.${payload}.${base64Url(new Uint8Array(signature))}`;
}

export async function installationAccessToken(installationId: number, repository: string, configuration: GitHubAppConfiguration, mode: "read" | "publish" = "read") {
  const response = await fetch(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${await appJwt(configuration)}`,
      "Content-Type": "application/json",
      "User-Agent": "design-harness",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ repositories: [repository], permissions: mode === "publish" ? { contents: "write", pull_requests: "write" } : { contents: "read" } }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(error?.message ?? `GitHub App token request failed (${response.status}).`);
  }
  const payload = await response.json() as { token?: string; expires_at?: string };
  if (!payload.token) throw new Error("GitHub did not return an installation token.");
  return { token: payload.token, expiresAt: payload.expires_at ?? null };
}
