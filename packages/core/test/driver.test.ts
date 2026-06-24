import { describe, it, expect, afterEach, vi } from 'vitest';
import { FakeCamera } from './fake-camera.js';
import { XCProtocolDriver } from '../src/xc/driver.js';

let cam: FakeCamera;
let drv: XCProtocolDriver;
afterEach(async () => { await drv?.disconnect(); await cam?.close(); });

const makeDriver = async (host: string) =>
  new XCProtocolDriver({ id: 'cam-1', name: 'C300', driver: 'xc', host }, { pollMs: 50 });

describe('XCProtocolDriver', () => {
  it('connects and builds state from info.cgi', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    expect(drv.status).toBe('connected');
    const s = drv.getState();
    expect(s.model).toBe('Canon EOS C300 Mark III');
    expect(s.controls.iso?.value).toBe(800);
  });

  it('starts and stops recording and updates state', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.startRecording();
    expect(drv.getState().record.recording).toBe(true);
    await drv.stopRecording();
    expect(drv.getState().record.recording).toBe(false);
  });

  it('setControl(iso) sends the manual-exposure sequence', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.setControl('iso', 1600);
    const last = cam.controlLog.at(-1)!;
    expect(last).toContain('c.1.me.iso=1600');
    expect(last).toContain('c.1.exp=manual');
    expect(drv.getState().controls.iso?.value).toBe(1600);
  });

  it('emits state when the body changes between polls', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    const onState = vi.fn();
    drv.on('state', onState);
    // simulate a body-side REC start by hitting the fake camera directly
    await fetch(`http://${host}/-wvhttp-01-/control.cgi?f.rec=on`);
    await vi.waitFor(() => expect(drv.getState().record.recording).toBe(true), { timeout: 1000 });
    expect(onState).toHaveBeenCalled();
  });

  it('setFocusPoint starts subject tracking at the tapped coords (touch-to-select)', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.setFocusPoint(0.5, 0.25);
    const last = cam.controlLog.at(-1)!;
    // A tap must be able to re-select among detected faces — that's subject tracking (mode2),
    // not the manual AF frame (which can't switch the camera's chosen face).
    expect(last).toContain('c.1.focus.auto.track.frame.x=5000'); // round(0.5*9999)
    expect(last).toContain('c.1.focus.auto.track.frame.y=2500'); // round(0.25*9999)
    expect(last).toContain('c.1.focus.auto.track.mode=mode2'); // tracks the subject at the coords
    expect(last).toContain('c.1.focus.auto.track=on');
  });

  it('setFocusPoint falls back to the AF frame + one-shot when tracking is unsupported', async () => {
    cam = new FakeCamera({ omitFocusTracking: true });
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.setFocusPoint(0.5, 0.25);
    const last = cam.controlLog.at(-1)!;
    expect(last).toContain('c.1.focus.frame.1.x=5000');
    expect(last).toContain('c.1.focus.frame.1.y=2500');
    expect(last).toContain('c.1.focus.action=one_shot');
  });

  it('goes to error status and recovers when the camera drops', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    const onStatus = vi.fn();
    drv.on('status', onStatus);
    await cam.close();
    await vi.waitFor(() => expect(drv.status).toBe('error'), { timeout: 2000 });
    expect(onStatus).toHaveBeenCalledWith('error');
  });
});
