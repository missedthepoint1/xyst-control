import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const infoBody = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

export interface FakeCameraOptions {
  /** Require Digest auth with these creds before answering. */
  auth?: { username: string; password: string };
  /** Fail this many requests with a network error before succeeding. */
  failFirst?: number;
}

/** A minimal in-memory XC Protocol camera for tests. */
export class FakeCamera {
  private server: Server;
  private state: Record<string, string> = {};
  private failsLeft: number;
  /** Records of received control.cgi query strings, for assertions. */
  readonly controlLog: string[] = [];

  constructor(private opts: FakeCameraOptions = {}) {
    this.failsLeft = opts.failFirst ?? 0;
    // seed mutable state from the fixture
    for (const line of infoBody.split('\n')) {
      const i = line.indexOf(':=');
      if (i > 0) this.state[line.slice(0, i).trim()] = line.slice(i + 2).trim();
    }
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const { port } = this.server.address() as AddressInfo;
    return `127.0.0.1:${port}`;
  }
  async close(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    if (this.failsLeft > 0) { this.failsLeft--; req.destroy(); return; }

    if (this.opts.auth && !req.headers.authorization) {
      res.writeHead(401, {
        'www-authenticate': 'Digest realm="cam", nonce="testnonce", qop="auth"',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '', 'http://x');
    const cmd = url.pathname.replace('/-wvhttp-01-/', '');

    if (cmd === 'control.cgi') {
      this.controlLog.push(url.search.slice(1));
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('c.') || k.startsWith('f.')) this.state[k] = v;
      }
      // mirror f.rec=on/off into f.rec.status
      const rec = url.searchParams.get('f.rec');
      if (rec === 'on') this.state['f.rec.status'] = 'rec';
      if (rec === 'off') this.state['f.rec.status'] = 'idle';
    }

    const body = Object.entries(this.state).map(([k, v]) => `${k}:=${v}`).join('\n');
    res.writeHead(200, {
      'content-type': 'text/plain;charset=utf-8',
      'livescope-status': '0',
    });
    res.end(body);
  }
}
