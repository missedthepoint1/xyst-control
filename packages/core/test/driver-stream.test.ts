import { describe, it, expect, afterEach, vi } from 'vitest';
import { FakeCamera } from './fake-camera.js';
import { XCProtocolDriver } from '../src/xc/driver.js';

let cam: FakeCamera;
let drv: XCProtocolDriver;
afterEach(async () => { await drv?.disconnect(); await cam?.close(); });

const makeDriver = (host: string) =>
  new XCProtocolDriver({ id: 'c', name: 'C300', driver: 'xc', host },
    { pollMs: 50, reconcileMs: 300, tcPollMs: 30 });

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

  it('reports the running timecode from the dedicated TC session, preserving run/drop-frame', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = makeDriver(host);
    await drv.connect();
    // Config (run/drop-frame) comes from sessionless info.cgi; the running value comes from the
    // TC session reading the bare f.timecode (NOT f.timecode.set, which is the static preset).
    expect(drv.getState().timecode).toMatchObject({ run: 'freerun', dropFrame: false });
    await vi.waitFor(() => expect(drv.getState().timecode?.value).toBe('01:00:00:00'), { timeout: 1000 });
    cam.setTimecode('01:00:05:12'); // the running TC advances
    await vi.waitFor(() => expect(drv.getState().timecode?.value).toBe('01:00:05:12'), { timeout: 1000 });
    expect(drv.getState().timecode?.run).toBe('freerun'); // config NOT wiped by the value update
    expect(drv.getState().timecode?.dropFrame).toBe(false);
  });

  it('preserves a control list when a body delta carries only the value', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = makeDriver(host);
    await drv.connect();
    const before = drv.getState().controls.iso?.list?.length ?? 0;
    expect(before).toBeGreaterThan(1);
    cam.pushDelta({ 'c.1.me.iso': '3200' });
    await vi.waitFor(() => expect(drv.getState().controls.iso?.value).toBe(3200), { timeout: 1000 });
    expect(drv.getState().controls.iso?.list?.length).toBe(before); // list NOT wiped
  });
});
