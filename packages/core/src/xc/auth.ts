import { createHash } from 'node:crypto';

export interface DigestChallenge {
  scheme: 'digest';
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

export function buildBasicHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Parse a `WWW-Authenticate` value. Returns null if not Digest. */
export function parseChallenge(header: string): DigestChallenge | null {
  if (!/^digest/i.test(header.trim())) return null;
  const body = header.trim().replace(/^digest\s+/i, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
    out[m[1]!.toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  if (!out.realm || !out.nonce) return null;
  return {
    scheme: 'digest',
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop?.split(',')[0]?.trim(),
    opaque: out.opaque,
    algorithm: out.algorithm,
  };
}

export function buildDigestHeader(opts: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  cnonce: string;
  nc: number;
}): string {
  const { username, password, method, uri, challenge, cnonce } = opts;
  const nc = opts.nc.toString(16).padStart(8, '0');
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = challenge.qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.qop) parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  return 'Digest ' + parts.join(', ');
}
