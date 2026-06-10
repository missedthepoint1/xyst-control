import { describe, it, expect, afterEach, vi } from 'vitest';
import { FakeCamera } from './fake-camera.js';
import { XCProtocolDriver } from '../src/xc/driver.js';

let cam: FakeCamera;
let drv: XCProtocolDriver;
afterEach(async () => { await drv?.disconnect(); await cam?.close(); });

const makeDriver = (host: string) =>
  new XCProtocolDriver({ id: 'c', name: 'C300', driver: 'xc', host },
    { pollMs: 50, reconcileMs: 300 });

describe('XCProtocolDriver streaming', () => {
  it('reflects a body-side change via the stream quickly', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = makeDriver(host);
    await drv.connect();
    const onState = vi.fn();
    drv.on('state', onState);
    cam.pushDelta({ 'c.1.me.iso': '3200' });
    await vi.waitFor(() => expect(drv.getState().controls.iso?.value).toBe(3200), { timeout: 1000 });
    expect(onState).toHaveBeenCalled();
  });

  it('applySettings sends one merged control.cgi with all params', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = makeDriver(host);
    await drv.connect();
    await drv.applySettings({ iso: 1600, nd: 1600, wbKelvin: 5600 });
    const last = cam.controlLog.at(-1)!;
    expect(last).toContain('c.1.me.iso=1600');
    expect(last).toContain('c.1.nd.filter=1600');
    expect(last).toContain('c.1.wb.kelvin=5600');
  });

  it('still connects and reports state with streaming enabled', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = makeDriver(host);
    await drv.connect();
    expect(drv.status).toBe('connected');
    expect(drv.getState().model).toBe('Canon EOS C300 Mark III');
  });
});
