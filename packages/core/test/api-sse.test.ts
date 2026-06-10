import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

let cam: FakeCamera; let mgr: CameraManager; let server: import('node:http').Server; let base: string;
afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await mgr?.disconnectAll(); await cam?.close();
});

describe('SSE /api/events', () => {
  it('streams a state event when the camera records', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
    const file = join(dir, 'cameras.json');
    writeFileSync(file, JSON.stringify({ cameras: [{ id: 'cam-1', name: 'C', driver: 'xc', host }] }));
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load(); await mgr.connect('cam-1');
    server = createApiServer(mgr);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const ctrl = new AbortController();
    const seen: string[] = [];
    const reading = (async () => {
      const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          seen.push(dec.decode(value, { stream: true }));
        }
      } catch { /* aborted */ }
    })();

    await new Promise((r) => setTimeout(r, 100));
    await fetch(`${base}/api/cameras/cam-1/record/start`, { method: 'POST' });
    await vi.waitFor(() => expect(seen.join('')).toMatch(/event: state/), { timeout: 2000 });
    expect(seen.join('')).toMatch(/"recording":true/);
    ctrl.abort();
    await reading;
  });
});
