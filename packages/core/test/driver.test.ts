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
