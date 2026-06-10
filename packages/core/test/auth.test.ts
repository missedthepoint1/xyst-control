import { describe, it, expect } from 'vitest';
import { parseChallenge, buildDigestHeader, buildBasicHeader } from '../src/xc/auth.js';

describe('auth headers', () => {
  it('builds a Basic header', () => {
    expect(buildBasicHeader('user', 'pass')).toBe(
      'Basic ' + Buffer.from('user:pass').toString('base64'),
    );
  });

  it('parses a Digest WWW-Authenticate challenge', () => {
    const c = parseChallenge(
      'Digest realm="cam", nonce="abc", qop="auth", opaque="zz"',
    );
    expect(c).toMatchObject({ scheme: 'digest', realm: 'cam', nonce: 'abc', qop: 'auth', opaque: 'zz' });
  });

  it('builds a deterministic Digest header (fixed cnonce)', () => {
    const header = buildDigestHeader({
      username: 'admin', password: 'secret',
      method: 'GET', uri: '/-wvhttp-01-/info.cgi',
      challenge: { scheme: 'digest', realm: 'cam', nonce: 'n0', qop: 'auth' },
      cnonce: 'deadbeef', nc: 1,
    });
    expect(header).toContain('Digest ');
    expect(header).toContain('username="admin"');
    expect(header).toContain('realm="cam"');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="deadbeef"');
    expect(header).toMatch(/response="[0-9a-f]{32}"/);
  });
});
