import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

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
      this.controlLog.push(url.search.slice(1));
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
