import { randomBytes } from 'node:crypto';
import { parseXcBody } from './parse.js';
import { parseChallenge, buildDigestHeader, buildBasicHeader } from './auth.js';
import type { CameraAuth } from '../types.js';

export interface InfoStreamHandlers {
  onDelta: (items: Record<string, string>) => void;
  onError: (err: Error) => void;
  onOpen?: () => void;
}

export interface InfoStreamOptions {
  auth?: CameraAuth;
  item?: string;
}

export interface InfoStreamHandle {
  close(): void;
}

const BASE = '/-wvhttp-01-/';

export function openInfoStream(
  host: string,
  opts: InfoStreamOptions,
  handlers: InfoStreamHandlers,
): InfoStreamHandle {
  const controller = new AbortController();
  let closed = false;
  const close = () => { closed = true; controller.abort(); };

  void run(host, opts, handlers, controller.signal, () => closed).catch((err) => {
    if (!closed) handlers.onError(err instanceof Error ? err : new Error(String(err)));
  });

  return { close };
}

async function run(
  host: string,
  opts: InfoStreamOptions,
  handlers: InfoStreamHandlers,
  signal: AbortSignal,
  isClosed: () => boolean,
): Promise<void> {
  const params = new URLSearchParams({ type: 'stream' });
  if (opts.item) params.set('item', opts.item);
  const path = `${BASE}info.cgi?${params.toString()}`;
  const url = `http://${host}${path}`;

  let res = await fetch(url, { signal });
  if (res.status === 401 && opts.auth?.username) {
    const header = authHeader(res, path, opts.auth);
    if (header) res = await fetch(url, { signal, headers: { Authorization: header } });
  }
  if (res.status !== 200 || !res.body) {
    throw new Error(`stream open failed: HTTP ${res.status}`);
  }

  const boundary = parseBoundary(res.headers.get('content-type'));
  handlers.onOpen?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const delim = `--${boundary}`;

  while (!isClosed()) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Split on delimiter; each resulting segment (except possibly the last)
    // is a complete part if it contains the header/body separator.
    const segments = buf.split(delim);
    // The last segment may be incomplete (no header+body sep yet) — keep it in buf.
    buf = segments.pop() ?? '';

    for (const seg of segments) {
      if (seg.trim()) emitPart(delim + seg, delim, handlers);
    }

    // Also flush the trailing segment if it already has a complete header+body.
    // The server writes each part terminated with \r\n, so a complete part will
    // have both the header separator (\r\n\r\n) and a body ending in \r\n.
    if (buf.includes('\r\n\r\n')) {
      const trailing = buf;
      buf = '';
      emitPart(delim + trailing, delim, handlers);
    }
  }
  if (!isClosed()) throw new Error('stream ended');
}

function emitPart(chunk: string, delim: string, handlers: InfoStreamHandlers): void {
  let part = chunk;
  if (part.startsWith(delim)) part = part.slice(delim.length);
  const sep = part.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n';
  const headerEnd = part.indexOf(sep);
  const body = headerEnd === -1 ? part : part.slice(headerEnd + sep.length);
  const map = parseXcBody(body);
  if (Object.keys(map).length > 0) handlers.onDelta(map);
}

function parseBoundary(contentType: string | null): string {
  const m = contentType?.match(/boundary=("?)([^";]+)\1/i);
  return m?.[2]?.trim() ?? 'boundary';
}

function authHeader(res: Response, path: string, auth: CameraAuth): string | null {
  const www = res.headers.get('www-authenticate') ?? '';
  const challenge = parseChallenge(www);
  const { username = '', password = '' } = auth;
  if (challenge) {
    return buildDigestHeader({
      username, password, method: 'GET', uri: path, challenge,
      cnonce: randomBytes(8).toString('hex'), nc: 1,
    });
  }
  if (/^basic/i.test(www)) return buildBasicHeader(username, password);
  return null;
}
