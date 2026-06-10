import { describe, it, expect } from 'vitest';
import { parseXcBody } from '../src/xc/parse.js';

describe('parseXcBody', () => {
  it('parses := and == lines into a flat map', () => {
    const body = [
      'c.1.type:=Canon EOS C300 Mark III',
      'c.1.exp==manual',
      'f.rec.status:=idle',
    ].join('\n');
    expect(parseXcBody(body)).toEqual({
      'c.1.type': 'Canon EOS C300 Mark III',
      'c.1.exp': 'manual',
      'f.rec.status': 'idle',
    });
  });

  it('splits on the first separator so values keep their colons', () => {
    expect(parseXcBody('s.origin:=192.168.100.1:80')).toEqual({
      's.origin': '192.168.100.1:80',
    });
  });

  it('trims whitespace and ignores blank lines', () => {
    expect(parseXcBody('\n  c.1.wb := kelvin \n\n')).toEqual({ 'c.1.wb': 'kelvin' });
  });

  it('last value wins for a repeated key', () => {
    expect(parseXcBody('a:=1\na:=2')).toEqual({ a: '2' });
  });
});
