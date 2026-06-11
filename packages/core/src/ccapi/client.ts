import { randomBytes } from 'node:crypto';
import { buildBasicHeader, buildDigestHeader, parseChallenge } from '../xc/auth.js';
import type { CameraAuth } from '../types.js';

/**
 * JSON HTTP client for Canon's Camera Control API (CCAPI). Robust by default —
 * timeout, retry, and Basic/Digest auth (reusing the shared auth helpers). CCAPI is a
 * documented REST/JSON API (`/ccapi/verNNN/...`), so unlike the R5 C client this one is
 * JSON-native and surfaces the camera's error `message` on failures.
 *
 * Note: `host` must include the CCAPI port the camera shows (e.g. `192.168.1.50:8080`).
 */
export interface CcapiOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  auth?: CameraAuth;
}

async function once(
  url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { method, headers, body, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function send(host: string, path: string, opts: CcapiOptions): Promise<Response> {
  const { method = 'GET', body, timeoutMs = 4000, retries = 2, auth } = opts;
  const url = `http://${host}${path}`;
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (bodyStr !== undefined) headers['content-type'] = 'application/json';
  if (auth?.username) headers['authorization'] = buildBasicHeader(auth.username, auth.password ?? '');

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res = await once(url, method, headers, bodyStr, timeoutMs);
      if (res.status === 401 && auth?.username) {
        const challenge = parseChallenge(res.headers.get('www-authenticate') ?? '');
        if (challenge) {
          const digest = buildDigestHeader({
            username: auth.username, password: auth.password ?? '', method, uri: path, challenge,
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
  throw lastErr instanceof Error ? lastErr : new Error('CCAPI request failed');
}

/** Perform a CCAPI request and return the parsed JSON body (or {} when empty). */
export async function ccapiJson<T = unknown>(host: string, path: string, opts: CcapiOptions = {}): Promise<T> {
  const res = await send(host, path, opts);
  const text = await res.text();
  if (res.status >= 400) {
    let detail = '';
    try { detail = (JSON.parse(text) as { message?: string })?.message ?? ''; } catch { /* non-JSON error */ }
    throw new Error(`CCAPI ${opts.method ?? 'GET'} ${path} -> ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}
