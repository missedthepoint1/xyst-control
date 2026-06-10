import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';

let cam: FakeCamera;
let mgr: CameraManager;
afterEach(async () => { await mgr?.disconnectAll(); await cam?.close(); });

function configWith(host: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
  const file = join(dir, 'cameras.json');
  writeFileSync(file, JSON.stringify({
    cameras: [{ id: 'cam-1', name: 'C300', driver: 'xc', host }],
  }));
  return file;
}

describe('CameraManager', () => {
  it('loads profiles and connects a camera', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    expect(mgr.getState('cam-1')?.status).toBe('connected');
  });

  it('routes record + setControl to the right driver', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    await mgr.startRecording('cam-1');
    expect(mgr.getState('cam-1')?.record.recording).toBe(true);
    await mgr.setControl('cam-1', 'nd', 1600);
    expect(mgr.getState('cam-1')?.controls.nd?.value).toBe(1600);
  });

  it('re-emits state events tagged with camera id', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    const onState = vi.fn();
    mgr.on('state', onState);
    await mgr.connect('cam-1');
    expect(onState).toHaveBeenCalledWith('cam-1', expect.objectContaining({ id: 'cam-1' }));
  });

  it('adds and persists a new profile', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.addCamera({ id: 'cam-2', name: 'C80', driver: 'xc', host });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras.map((c: any) => c.id)).toContain('cam-2');
  });
});
