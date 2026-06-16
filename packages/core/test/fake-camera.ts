import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';
import { encode } from '@msgpack/msgpack';

const infoBody = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

const BOUNDARY = 'xystbnd';

export interface FakeCameraOptions {
  auth?: { username: string; password: string };
  failFirst?: number;
}

export class FakeCamera {
  private server: Server;
  private state: Record<string, string> = {};
  private failsLeft: number;
  private streams = new Set<ServerResponse>();
  private tcValue = '01:00:00:00'; // running timecode served via the session (bare f.timecode)
  readonly controlLog: string[] = [];

  constructor(private opts: FakeCameraOptions = {}) {
    this.failsLeft = opts.failFirst ?? 0;
    for (const line of infoBody.split('\n')) {
      const i = line.indexOf(':=');
      if (i > 0) this.state[line.slice(0, i).trim()] = line.slice(i + 2).trim();
    }
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async close(): Promise<void> {
    for (const s of this.streams) s.end();
    this.streams.clear();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Advance the running timecode served over the session (the bare f.timecode field). */
  setTimecode(value: string): void { this.tcValue = value; }

  /** Simulate a body-side change: update state and push the delta to open streams. */
  pushDelta(delta: Record<string, string>): void {
    if (Object.keys(delta).length === 0) return;
    Object.assign(this.state, delta);
    this.writeToStreams(delta);
  }

  private writeToStreams(map: Record<string, string>): void {
    const body = Object.entries(map).map(([k, v]) => `${k}:=${v}`).join('\n');
    for (const res of this.streams) {
      res.write(`--${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);
    }
  }

  private writeInitial(res: ServerResponse): void {
    const body = Object.entries(this.state).map(([k, v]) => `${k}:=${v}`).join('\n');
    res.write(`--${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);
  }

  private handle(req: import('node:http').IncomingMessage, res: ServerResponse) {
    if (this.failsLeft > 0) { this.failsLeft--; req.destroy(); return; }
    if (this.opts.auth && !req.headers.authorization) {
      res.writeHead(401, { 'www-authenticate': 'Digest realm="cam", nonce="testnonce", qop="auth"' });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '', 'http://x');
    const cmd = url.pathname.replace('/-wvhttp-01-/', '');

    if (cmd === 'image.cgi') {
      res.writeHead(200, { 'content-type': 'image/jpeg', 'livescope-status': '0' });
      res.end(Buffer.from([0xff, 0xd8, 0xff, 0xd9])); // minimal JPEG bytes
      return;
    }

    if (cmd === 'meta.cgi') {
      const body = encode({
        version: '3.0.0', timestamp: 1, realtime: 1,
        detect: [{ type: 'face', pos: { x: 5000, y: 4000, w: 1200, h: 1800 }, main: true, track: true }],
        fguide: [],
      });
      res.writeHead(200, { 'content-type': 'application/x-msgpack', 'livescope-status': '0' });
      res.end(Buffer.from(body));
      return;
    }

    // Session lifecycle for the running-timecode reader.
    if (cmd === 'open.cgi') {
      res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
      res.end('s:=tcsid\ns.authority.control:=enabled\ns.duration:=0');
      return;
    }
    if (cmd === 'close.cgi') {
      res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
      res.end('');
      return;
    }
    // Session read of the bare f.timecode — only present once f.timecode.info=on was set (like the body).
    if (cmd === 'info.cgi' && url.searchParams.has('s') && url.searchParams.get('item') === 'f.timecode') {
      const lines = Object.entries(this.state)
        .filter(([k]) => k.startsWith('f.timecode'))
        .map(([k, v]) => `${k}:=${v}`);
      if (this.state['f.timecode.info'] === 'on') lines.push(`f.timecode:=${this.tcValue}`);
      res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
      res.end(lines.join('\n'));
      return;
    }

    if (cmd === 'info.cgi' && url.searchParams.get('type') === 'stream') {
      res.writeHead(200, {
        'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        'livescope-status': '0',
      });
      this.streams.add(res);
      req.on('close', () => this.streams.delete(res));
      this.writeInitial(res);
      return;
    }

    if (cmd === 'control.cgi') {
      // Only log real (sessionless) control commands; the TC session's `s=…&f.timecode.info=on`
      // is keepalive/setup noise that would otherwise clobber controlLog.at(-1) assertions.
      if (!url.searchParams.has('s')) this.controlLog.push(url.search.slice(1));
      const changed: Record<string, string> = {};
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('c.') || k.startsWith('f.')) { this.state[k] = v; changed[k] = v; }
      }
      const rec = url.searchParams.get('f.rec');
      if (rec === 'on') { this.state['f.rec.status'] = 'rec'; changed['f.rec.status'] = 'rec'; }
      if (rec === 'off') { this.state['f.rec.status'] = 'idle'; changed['f.rec.status'] = 'idle'; }
      if (Object.keys(changed).length > 0) this.writeToStreams(changed);
    }

    const body = Object.entries(this.state).map(([k, v]) => `${k}:=${v}`).join('\n');
    res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
    res.end(body);
  }
}
