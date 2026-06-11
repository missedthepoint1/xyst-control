import { randomBytes } from 'node:crypto';
import { buildBasicHeader, buildDigestHeader, parseChallenge } from '../xc/auth.js';
import type { CameraAuth, PreviewFrame } from '../types.js';

/**
 * Generic HTTP helper for the R5 C Browser Remote. Unlike the XC client it makes no
 * assumption about paths/params (those are undocumented and captured per-camera) — it
 * just does a robust request with timeout, retry, and Basic/Digest auth. Fill the
 * endpoint descriptors in `endpoints.ts` from a capture and these helpers drive them.
 */
export interface R5CFetchOptions {
  method?: string;
  query?: Record<string, string | number>;
  body?: string | Record<string, unknown>;
  contentType?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  retries?: number;
  auth?: CameraAuth;
}

export interface R5CResponse { status: number; text: string; }

function withQuery(path: string, query?: Record<string, string | number>): string {
  if (!query || Object.keys(query).length === 0) return path;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) qs.append(k, String(v));
  return `${path}${path.includes('?') ? '&' : '?'}${qs.toString()}`;
}

async function once(url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method, headers, body, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function headersFor(opts: R5CFetchOptions, body: string | undefined): Record<string, string> {
  const h: Record<string, string> = { ...(opts.headers ?? {}) };
  if (body !== undefined && !('content-type' in h)) h['content-type'] = opts.contentType ?? 'application/json';
  if (opts.auth?.username) h['authorization'] = buildBasicHeader(opts.auth.username, opts.auth.password ?? '');
  return h;
}

/** Perform the request, transparently upgrading to Digest if the camera demands it. */
async function send(host: string, path: string, opts: R5CFetchOptions): Promise<Response> {
  const { method = 'GET', query, body, timeoutMs = 4000, retries = 2, auth } = opts;
  const uri = withQuery(path, query);
  const url = `http://${host}${uri}`;
  const bodyStr = body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  const headers = headersFor(opts, bodyStr);

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res = await once(url, method, headers, bodyStr, timeoutMs);
      if (res.status === 401 && auth?.username) {
        const challenge = parseChallenge(res.headers.get('www-authenticate') ?? '');
        if (challenge) {
          const digest = buildDigestHeader({
            username: auth.username, password: auth.password ?? '', method, uri, challenge,
            cnonce: randomBytes(8).toString('hex'), nc: 1,
          });
          res = await once(url, method, { ...headers, authorization: digest }, bodyStr, timeoutMs);
        }
      }
      return res;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('R5 C request failed');
}

export async function r5cFetch(host: string, path: string, opts: R5CFetchOptions = {}): Promise<R5CResponse> {
  const res = await send(host, path, opts);
  const text = await res.text();
  if (res.status >= 400) throw new Error(`R5 C ${opts.method ?? 'GET'} ${path} -> ${res.status}`);
  return { status: res.status, text };
}

export async function r5cFetchBinary(host: string, path: string, opts: R5CFetchOptions = {}): Promise<PreviewFrame> {
  const res = await send(host, path, opts);
  if (res.status >= 400) throw new Error(`R5 C ${opts.method ?? 'GET'} ${path} -> ${res.status}`);
  const data = new Uint8Array(await res.arrayBuffer());
  return { data, contentType: res.headers.get('content-type') ?? 'image/jpeg' };
}
