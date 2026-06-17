import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { request as httpRequest } from 'node:http';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

/** Sends an HTTP GET with full header control (fetch forbids Host overrides). */
function getRaw(url: string, headers: Record<string, string>): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = httpRequest({
      hostname: u.hostname,
      port: Number(u.port),
      path: u.pathname + u.search,
      method: 'GET',
      headers,
    }, (res) => {
      res.resume();
      res.on('end', () => resolve({ status: res.statusCode ?? 0 }));
    });
    req.on('error', reject);
    req.end();
  });
}

const TOKEN = 'test-token-123';
let cam: FakeCamera;
let mgr: CameraManager;
let server: import('node:http').Server;
let base: string;

afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await mgr?.disconnectAll();
  await cam?.close();
});

async function setup(): Promise<void> {
  cam = new FakeCamera();
  const host = await cam.listen();
  const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
  const file = join(dir, 'cameras.json');
  writeFileSync(file, JSON.stringify({ cameras: [{ id: 'cam-1', name: 'C300', driver: 'xc', host }] }));
  mgr = new CameraManager(file, { pollMs: 50 });
  await mgr.load();
  await mgr.connect('cam-1');
  server = createApiServer(mgr, { token: TOKEN });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('REST API auth', () => {
  it('401s a request with no token', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras`)).status).toBe(401);
  });

  it('allows a request with a valid Bearer token', async () => {
    await setup();
    const res = await fetch(`${base}/api/cameras`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });

  it('allows a valid ?token= query param (for img/EventSource)', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras?token=${TOKEN}`)).status).toBe(200);
  });

  it('401s a wrong token', async () => {
    await setup();
    const res = await fetch(`${base}/api/cameras`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('allows /api/health without a token', async () => {
    await setup();
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('rejects a non-loopback Host header (DNS-rebinding guard)', async () => {
    await setup();
    // fetch() treats 'host' as a forbidden header and silently drops it, so we use node:http directly.
    const res = await getRaw(`${base}/api/cameras?token=${TOKEN}`, {
      host: 'evil.example.com',
      authorization: `Bearer ${TOKEN}`,
    });
    expect(res.status).toBe(403);
  });
});
