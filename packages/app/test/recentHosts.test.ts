import { describe, it, expect } from 'vitest';
import { pushRecentHost } from '../src/renderer/recentHosts.js';

describe('pushRecentHost', () => {
  it('prepends a newly-used host (most-recent-first)', () => {
    expect(pushRecentHost(['192.168.10.5'], '192.168.10.8')).toEqual(['192.168.10.8', '192.168.10.5']);
  });

  it('moves an already-known host to the front without duplicating it', () => {
    expect(pushRecentHost(['192.168.10.5', '192.168.10.8'], '192.168.10.8'))
      .toEqual(['192.168.10.8', '192.168.10.5']);
  });

  it('caps the list at 10, dropping the oldest', () => {
    const ten = Array.from({ length: 10 }, (_, i) => `192.168.10.${i}`); // newest .0 … oldest .9
    const next = pushRecentHost(ten, '192.168.10.99');
    expect(next).toHaveLength(10);
    expect(next[0]).toBe('192.168.10.99');
    expect(next).not.toContain('192.168.10.9'); // oldest aged out
  });

  it('trims and ignores an empty / whitespace host', () => {
    expect(pushRecentHost(['192.168.10.5'], '   ')).toEqual(['192.168.10.5']);
    expect(pushRecentHost([], '  192.168.10.5 ')).toEqual(['192.168.10.5']);
  });

  it('dedupes case-insensitively (hostnames) keeping the new entry at front', () => {
    expect(pushRecentHost(['Canon-AB.local'], 'canon-ab.local')).toEqual(['canon-ab.local']);
  });
});
