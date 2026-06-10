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

  it('rejects adding a camera with a duplicate id', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load(); // config already has cam-1
    await expect(mgr.addCamera({ id: 'cam-1', name: 'dupe', driver: 'xc', host }))
      .rejects.toThrow(/already exists/);
  });

  it('throws a clear error when the config file is corrupt', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
    const file = join(dir, 'cameras.json');
    writeFileSync(file, '{ this is not valid json');
    mgr = new CameraManager(file, { pollMs: 50 });
    await expect(mgr.load()).rejects.toThrow(/invalid camera config/);
  });

  it('saves a preset capturing the current settings and persists it', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Look A');
    expect(preset.name).toBe('Look A');
    expect(preset.settings.iso).toBe(800);
    expect(preset.settings.gain).toBeUndefined(); // gain excluded (mutually exclusive with iso)
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras[0].presets.map((p: any) => p.name)).toContain('Look A');
  });

  it('recalls a preset by applying its settings to the camera', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Look A');
    await mgr.setControl('cam-1', 'iso', 3200);
    await mgr.recallPreset('cam-1', preset.id);
    expect(cam.controlLog.at(-1)).toContain('c.1.me.iso=800');
  });

  it('deletes a preset and persists the removal', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Temp');
    await mgr.deletePreset('cam-1', preset.id);
    expect(mgr.listPresets('cam-1')).toHaveLength(0);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras[0].presets ?? []).toHaveLength(0);
  });
});
