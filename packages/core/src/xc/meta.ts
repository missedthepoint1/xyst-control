import { decode } from '@msgpack/msgpack';
import { parseChallenge, buildDigestHeader, buildBasicHeader } from './auth.js';
import { randomBytes } from 'node:crypto';
import type { CameraAuth, CameraMeta, DetectBox, FocusGuide } from '../types.js';

const BASE = '/-wvhttp-01-/';

interface RawPos { x?: number; y?: number; w?: number; h?: number }
interface RawDetect { type?: string; pos?: RawPos; main?: boolean; track?: boolean }
interface RawGuide { status?: boolean; level?: number; angle?: number; dir?: string; pos?: RawPos }
interface RawMeta { detect?: RawDetect[]; fguide?: RawGuide[] }

export async function fetchMeta(
  host: string,
  opts: { auth?: CameraAuth; timeoutMs?: number } = {},
): Promise<CameraMeta> {
  const path = `${BASE}meta.cgi?type=once`;
  const url = `http://${host}${path}`;
  const timeoutMs = opts.timeoutMs ?? 4000;

  const doFetch = (headers?: Record<string, string>) => {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    return fetch(url, { headers, signal: ctrl.signal }).finally(() => clearTimeout(t));
  };

  let res = await doFetch();

  if (res.status === 401 && opts.auth?.username) {
    const www = res.headers.get('www-authenticate') ?? '';
    const challenge = parseChallenge(www);
    const { username = '', password = '' } = opts.auth;
    let header: string | null = null;
    if (challenge) {
      header = buildDigestHeader({
        username,
        password,
        method: 'GET',
        uri: path,
        challenge,
        cnonce: randomBytes(8).toString('hex'),
        nc: 1,
      });
    } else if (/^basic/i.test(www)) {
      header = buildBasicHeader(username, password);
    }
    if (header) res = await doFetch({ Authorization: header });
  }

  if (res.status !== 200) throw new Error(`meta.cgi HTTP ${res.status}`);

  const raw = decode(new Uint8Array(await res.arrayBuffer())) as RawMeta;

  const detect: DetectBox[] = (raw.detect ?? []).map((d) => ({
    type: (d.type as DetectBox['type']) ?? 'object',
    x: d.pos?.x ?? 0,
    y: d.pos?.y ?? 0,
    w: d.pos?.w ?? 0,
    h: d.pos?.h ?? 0,
    main: Boolean(d.main),
    track: Boolean(d.track),
  }));

  const g = raw.fguide?.[0];
  const fguide: FocusGuide | undefined = g
    ? {
        status: Boolean(g.status),
        level: g.level ?? 0,
        angle: g.angle ?? 0,
        dir: g.dir ?? 'front',
        x: g.pos?.x ?? 0,
        y: g.pos?.y ?? 0,
        w: g.pos?.w ?? 0,
        h: g.pos?.h ?? 0,
      }
    : undefined;

  return { detect, fguide };
}
