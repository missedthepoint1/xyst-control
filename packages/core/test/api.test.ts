import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

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
  server = createApiServer(mgr);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('REST API', () => {
  it('GET /api/health', async () => {
    await setup();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/cameras returns states', async () => {
    await setup();
    const cams = await (await fetch(`${base}/api/cameras`)).json();
    expect(cams[0].id).toBe('cam-1');
    expect(cams[0].model).toBe('Canon EOS C300 Mark III');
  });

  it('GET /api/cameras/:id/status returns a flat summary', async () => {
    await setup();
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(false);
    expect(st.controls.iso).toBe(800);
  });

  it('POST record/start then status shows recording', async () => {
    await setup();
    const r = await fetch(`${base}/api/cameras/cam-1/record/start`, { method: 'POST' });
    expect(r.status).toBe(200);
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(true);
  });

  it('POST a control sets it', async () => {
    await setup();
    await fetch(`${base}/api/cameras/cam-1/controls/iso`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 1600 }),
    });
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.controls.iso).toBe(1600);
  });

  it('save then recall a preset by global id', async () => {
    await setup();
    const preset = await (await fetch(`${base}/api/cameras/cam-1/presets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Look' }),
    })).json();
    expect(preset.name).toBe('Look');
    const recall = await fetch(`${base}/api/presets/${preset.id}/recall`, { method: 'POST' });
    expect(recall.status).toBe(200);
  });

  it('404 for unknown camera', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras/nope`)).status).toBe(404);
  });

  it('REC ALL / STOP ALL', async () => {
    await setup();
    expect((await fetch(`${base}/api/record/start`, { method: 'POST' })).status).toBe(200);
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(true);
    await fetch(`${base}/api/record/stop`, { method: 'POST' });
  });

  it('responds 404 (does not hang) for a malformed percent-encoded path', async () => {
    await setup();
    const r = await fetch(`${base}/api/cameras/%xyz/status`);
    expect(r.status).toBe(404);
  });

  it('rejects a null control value with 400', async () => {
    await setup();
    const r = await fetch(`${base}/api/cameras/cam-1/controls/iso`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: null }),
    });
    expect(r.status).toBe(400);
  });

  it('404 for presets of an unknown camera', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras/nope/presets`)).status).toBe(404);
  });
});
