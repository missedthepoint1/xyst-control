import { randomBytes } from 'node:crypto';
import http from 'node:http';
import https from 'node:https';
import { URL } from 'node:url';
import { buildBasicHeader, buildDigestHeader, parseChallenge } from '../xc/auth.js';
import type { CameraAuth } from '../types.js';

/**
 * JSON HTTP client for Canon's Camera Control API (CCAPI). Robust by default —
 * timeout, retry, and Basic/Digest auth (reusing the shared auth helpers). CCAPI is a
 * documented REST/JSON API (`/ccapi/verNNN/...`), so unlike the R5 C client this one is
 * JSON-native and surfaces the camera's error `message` on failures.
 *
 * Transport: modern CCAPI bodies (verified against a live EOS R6 Mark III, firmware 1.0.0)
 * serve over **HTTPS on port 443 with a self-signed certificate** — the camera is its own CA.
 * So `host` is normalised to an `https://` base and the request skips cert verification
 * (`rejectUnauthorized: false`); these are LAN devices reached by IP, never public endpoints.
 * We use the `node:http(s)` core modules rather than `fetch` deliberately: the only `fetch`
 * route to a self-signed cert needs an undici dispatcher, and undici drags in a `node:sqlite`
 * cache module that Electron's bundled Node can't load. `host` may carry an explicit
 * `http://`/`https://` scheme to override (e.g. an older body on `http://ip:8080`); bare hosts
 * default to HTTPS. Include the port only if it isn't the scheme default (the R6 III shows `:443`).
 */
export interface CcapiOptions {
  method?: string;
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
  auth?: CameraAuth;
}

/** Minimal response shape the client needs — a thin wrapper over the node:http response. */
interface RawResponse {
  status: number;
  text: string;
  header(name: string): string | undefined;
}

/** Normalise a profile host into a CCAPI base URL, defaulting bare hosts to HTTPS. */
function baseUrl(host: string): string {
  const withScheme = /^https?:\/\//i.test(host) ? host : `https://${host}`;
  return withScheme.replace(/\/+$/, '');
}

function once(
  url: string, method: string, headers: Record<string, string>, body: string | undefined, timeoutMs: number,
): Promise<RawResponse> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const isHttps = u.protocol === 'https:';
    const mod = isHttps ? https : http;
    // Set Content-Length ourselves: without it node:http frames the body as
    // `Transfer-Encoding: chunked`, which the camera's embedded CCAPI server rejects with
    // "400 Illegal request header". This is why GETs worked but PUT/POST (record, controls) failed.
    const finalHeaders = body === undefined
      ? headers
      : { ...headers, 'content-length': String(Buffer.byteLength(body)) };
    const req = mod.request(
      {
        protocol: u.protocol,
        hostname: u.hostname,
        port: u.port || (isHttps ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers: finalHeaders,
        timeout: timeoutMs,
        // The camera presents a self-signed cert (it is its own CA) — accept it.
        ...(isHttps ? { rejectUnauthorized: false } : {}),
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => resolve({
          status: res.statusCode ?? 0,
          text: data,
          header: (name) => {
            const v = res.headers[name.toLowerCase()];
            return Array.isArray(v) ? v.join(', ') : v;
          },
        }));
      },
    );
    req.on('timeout', () => req.destroy(new Error(`CCAPI request timed out after ${timeoutMs}ms`)));
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

async function send(host: string, path: string, opts: CcapiOptions): Promise<RawResponse> {
  const { method = 'GET', body, timeoutMs = 4000, retries = 2, auth } = opts;
  const url = `${baseUrl(host)}${path}`;
  const bodyStr = body === undefined ? undefined : JSON.stringify(body);
  const headers: Record<string, string> = {};
  if (bodyStr !== undefined) headers['content-type'] = 'application/json';
  if (auth?.username) headers['authorization'] = buildBasicHeader(auth.username, auth.password ?? '');

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      let res = await once(url, method, headers, bodyStr, timeoutMs);
      if (res.status === 401 && auth?.username) {
        const challenge = parseChallenge(res.header('www-authenticate') ?? '');
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
  const text = res.text;
  if (res.status >= 400) {
    let detail = '';
    try { detail = (JSON.parse(text) as { message?: string })?.message ?? ''; } catch { /* non-JSON error */ }
    throw new Error(`CCAPI ${opts.method ?? 'GET'} ${path} -> ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  return (text ? JSON.parse(text) : {}) as T;
}
