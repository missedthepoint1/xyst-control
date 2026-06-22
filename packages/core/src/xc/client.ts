import { randomBytes } from 'node:crypto';
import { parseXcBody } from './parse.js';
import { XcError, LivescopeError, AuthError } from './errors.js';
import {
  parseChallenge, buildDigestHeader, buildBasicHeader, type DigestChallenge,
} from './auth.js';
import type { CameraAuth, PreviewFrame } from '../types.js';

export interface XcRequestOptions {
  timeoutMs?: number;
  retries?: number;
  auth?: CameraAuth;
  /** Override the random cnonce (tests). */
  cnonce?: string;
}

export interface XcResponse {
  map: Record<string, string>;
  livescope: number;
}

const BASE = '/-wvhttp-01-/';

function buildPath(command: string, params: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const search = qs.toString();
  return `${BASE}${command}${search ? `?${search}` : ''}`;
}

export async function xcRequest(
  host: string,
  command: string,
  params: Record<string, string | number> = {},
  opts: XcRequestOptions = {},
): Promise<XcResponse> {
  const { timeoutMs = 4000, retries = 2 } = opts;
  const path = buildPath(command, params);
  const url = `http://${host}${path}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, path, opts, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err instanceof LivescopeError || err instanceof AuthError) throw err; // not retryable
      if (attempt < retries) await delay(Math.min(250 * 2 ** attempt, 1000));
    }
  }
  throw new XcError(
    `request to ${command} failed after ${retries + 1} attempts: ${describeCause(lastErr)}`,
    lastErr,
  );
}

/** Readable one-liner for a failed fetch — undici wraps the OS error in `.cause`. */
function describeCause(err: unknown): string {
  if (err instanceof Error) {
    if (err.name === 'AbortError' || err.name === 'TimeoutError') return 'timed out';
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message) {
      const code = (cause as { code?: string }).code;
      return code ? `${code}: ${cause.message}` : cause.message;
    }
    const code = (err as { code?: string }).code;
    return code ? `${code}: ${err.message}` : err.message;
  }
  return String(err);
}

async function once(
  url: string,
  path: string,
  opts: XcRequestOptions,
  timeoutMs: number,
): Promise<XcResponse> {
  let res = await fetchWithTimeout(url, {}, timeoutMs);

  if (res.status === 401 && opts.auth?.username) {
    const header = authHeaderFor(res, path, opts);
    if (header) res = await fetchWithTimeout(url, { headers: { Authorization: header } }, timeoutMs);
  }

  if (res.status === 401) throw new AuthError(401, `authentication required or rejected for ${url}`);
  if (res.status !== 200) throw new XcError(`HTTP ${res.status} for ${url}`);

  const livescope = Number(res.headers.get('livescope-status') ?? '0');
  if (livescope !== 0) throw new LivescopeError(livescope, await res.text());

  const map = parseXcBody(await res.text());
  return { map, livescope };
}

function authHeaderFor(res: Response, path: string, opts: XcRequestOptions): string | null {
  const www = res.headers.get('www-authenticate') ?? '';
  const challenge: DigestChallenge | null = parseChallenge(www);
  const { username = '', password = '' } = opts.auth ?? {};
  if (challenge) {
    return buildDigestHeader({
      username, password, method: 'GET', uri: path, challenge,
      cnonce: opts.cnonce ?? randomBytes(8).toString('hex'), nc: 1,
    });
  }
  if (/^basic/i.test(www)) return buildBasicHeader(username, password);
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function xcRequestBinary(
  host: string,
  command: string,
  params: Record<string, string | number> = {},
  opts: XcRequestOptions = {},
): Promise<PreviewFrame> {
  const { timeoutMs = 4000 } = opts;
  const path = buildPath(command, params);
  const url = `http://${host}${path}`;
  let res = await fetchWithTimeout(url, {}, timeoutMs);
  if (res.status === 401 && opts.auth?.username) {
    const header = authHeaderFor(res, path, opts);
    if (header) res = await fetchWithTimeout(url, { headers: { Authorization: header } }, timeoutMs);
  }
  if (res.status !== 200) throw new XcError(`HTTP ${res.status} for ${url}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  return { data: buf, contentType: res.headers.get('content-type') ?? 'image/jpeg' };
}
