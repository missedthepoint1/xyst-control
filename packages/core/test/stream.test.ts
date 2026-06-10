import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openInfoStream } from '../src/xc/stream.js';

let srv: Server | undefined;
afterEach(() => { srv?.close(); srv = undefined; });

function streamServer(parts: string[], boundary = 'xystbnd'): Promise<string> {
  srv = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'livescope-status': '0',
    });
    let i = 0;
    const writeNext = () => {
      if (i >= parts.length) return;
      res.write(`--${boundary}\r\nContent-Type: text/plain\r\n\r\n${parts[i]}\r\n`);
      i++;
      setTimeout(writeNext, 20);
    };
    writeNext();
  });
  return new Promise((resolve) => srv!.listen(0, '127.0.0.1', () => {
    resolve(`127.0.0.1:${(srv!.address() as AddressInfo).port}`);
  }));
}

function fragmentServer(fragments: string[]): Promise<string> {
  srv = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'multipart/x-mixed-replace; boundary=xystbnd',
      'livescope-status': '0',
    });
    let i = 0;
    const writeNext = () => {
      if (i >= fragments.length) return;
      res.write(fragments[i]); i++;
      setTimeout(writeNext, 20);
    };
    writeNext();
  });
  return new Promise((resolve) => srv!.listen(0, '127.0.0.1', () => {
    resolve(`127.0.0.1:${(srv!.address() as import('node:net').AddressInfo).port}`);
  }));
}

describe('openInfoStream', () => {
  it('emits the initial full snapshot then deltas', async () => {
    const host = await streamServer([
      'c.1.type:=Canon EOS C300 Mark III\nc.1.me.iso:=800\nf.rec.status:=idle',
      'c.1.me.iso:=1600',
      'f.rec.status:=rec',
    ]);
    const deltas: Array<Record<string, string>> = [];
    const handle = openInfoStream(host, {}, { onDelta: (m) => deltas.push(m), onError: () => {} });
    await vi.waitFor(() => expect(deltas.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    handle.close();
    expect(deltas[0]!['c.1.type']).toBe('Canon EOS C300 Mark III');
    expect(deltas[1]!['c.1.me.iso']).toBe('1600');
    expect(deltas[2]!['f.rec.status']).toBe('rec');
  });

  it('calls onError when the connection is refused', async () => {
    const onError = vi.fn();
    const handle = openInfoStream('127.0.0.1:1', {}, { onDelta: () => {}, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 2000 });
    handle.close();
  });

  it('stops emitting after close()', async () => {
    const host = await streamServer(['a:=1', 'a:=2', 'a:=3', 'a:=4', 'a:=5']);
    const deltas: Array<Record<string, string>> = [];
    const handle = openInfoStream(host, {}, { onDelta: (m) => deltas.push(m), onError: () => {} });
    await vi.waitFor(() => expect(deltas.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    handle.close();
    const countAtClose = deltas.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(deltas.length).toBe(countAtClose);
  });

  it('reassembles a part body split across read chunks (no drop/corruption)', async () => {
    const host = await fragmentServer([
      '--xystbnd\r\nContent-Type: text/plain\r\n\r\nc.1.me.',   // body split mid-key
      'iso:=1600\r\n',
      '--xystbnd\r\nContent-Type: text/plain\r\n\r\nf.rec.status:=rec\r\n',
    ]);
    const deltas: Array<Record<string, string>> = [];
    const handle = openInfoStream(host, {}, { onDelta: (m) => deltas.push(m), onError: () => {} });
    await vi.waitFor(
      () => expect(deltas.some((d) => d['f.rec.status'] === 'rec')).toBe(true),
      { timeout: 2000 },
    );
    handle.close();
    // the iso part must arrive intact, exactly once, with the FULL key — no phantom 'iso'
    const isoDeltas = deltas.filter((d) => 'c.1.me.iso' in d);
    expect(isoDeltas).toHaveLength(1);
    expect(isoDeltas[0]!['c.1.me.iso']).toBe('1600');
    expect(deltas.some((d) => 'iso' in d && !('c.1.me.iso' in d))).toBe(false); // no phantom key
  });
});
