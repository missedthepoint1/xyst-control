import { describe, it, expect, afterEach, vi } from 'vitest';
import https from 'node:https';
import { EventEmitter } from 'node:events';
import { CcapiDriver } from '../src/ccapi/driver.js';

let drv: CcapiDriver;
afterEach(async () => { await drv?.disconnect(); vi.restoreAllMocks(); });

const SETTINGS = {
  iso: { value: '800', ability: ['auto', '100', '200', '400', '800', '1600'] },
  tv: { value: '1/100', ability: ['1/50', '1/100', '1/200'] },
  av: { value: 'f4.0', ability: ['f2.8', 'f4.0', 'f5.6'] },
  wb: { value: 'auto', ability: ['auto', 'daylight', 'shade'] },
  colortemperature: { value: 5200, ability: { min: 2500, max: 10000, step: 100 } },
  shootingmode: { value: 'm' },
};

type Call = { url: string; method: string; body?: string; headers: Record<string, string | number> };

/** Stub node:https so the CCAPI client talks to an in-memory R6 III over (mock) HTTPS. */
function mockCamera(): Call[] {
  const calls: Call[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  vi.spyOn(https, 'request').mockImplementation(((options: any, cb: any) => {
    const path = String(options.path);
    const method = String(options.method ?? 'GET');
    const headers = (options.headers ?? {}) as Record<string, string | number>;
    const url = `https://${options.hostname}:${options.port}${path}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req: any = new EventEmitter();
    let body: string | undefined;
    req.write = (chunk: unknown) => { body = String(chunk); };
    req.destroy = () => {};
    req.end = () => {
      calls.push({ url, method, body, headers });
      let payload: unknown = {};
      if (path.endsWith('/ccapi')) payload = { ver100: [] };
      else if (path.includes('/shooting/settings/')) payload = {}; // PUT a single setting
      else if (path.includes('/shooting/settings')) payload = SETTINGS;
      else if (path.includes('/deviceinformation')) payload = { productname: 'Canon EOS R6 Mark III' };
      else if (path.includes('/devicestatus/battery')) payload = { level: 85, kind: 'battery' };
      else if (path.includes('/recbutton')) payload = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const res: any = new EventEmitter();
      res.statusCode = 200;
      res.headers = { 'content-type': 'application/json' };
      res.setEncoding = () => {};
      queueMicrotask(() => {
        cb(res);
        res.emit('data', JSON.stringify(payload));
        res.emit('end');
      });
    };
    return req;
  }) as unknown as typeof https.request);
  return calls;
}

describe('CcapiDriver', () => {
  it('connects and capability-discovers controls from shooting/settings', async () => {
    mockCamera();
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9' }, { pollMs: 100000 });
    await drv.connect();
    expect(drv.status).toBe('connected');

    const s = drv.getState();
    expect(s.model).toBe('Canon EOS R6 Mark III');
    // ISO: numeric, 'auto' dropped from the list.
    expect(s.controls.iso?.value).toBe(800);
    expect(s.controls.iso?.list).toEqual([100, 200, 400, 800, 1600]);
    // Shutter: "1/100" -> 100 denominator.
    expect(s.controls.shutter?.value).toBe(100);
    expect(s.controls.shutter?.list).toEqual([50, 100, 200]);
    // Iris: "f4.0" -> 400 (F-number x100).
    expect(s.controls.iris?.value).toBe(400);
    expect(s.controls.iris?.list).toEqual([280, 400, 560]);
    // WB passthrough + colour temperature range.
    expect(s.controls.wb?.value).toBe('auto');
    expect(s.controls.wbKelvin?.value).toBe(5200);
    expect(s.controls.wbKelvin?.min).toBe(2500);
    expect(s.power?.percent).toBe(85);
  });

  it('records and maps control values back to the exact CCAPI strings', async () => {
    const calls = mockCamera();
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9' }, { pollMs: 100000 });
    await drv.connect();

    await drv.startRecording();
    const rec = calls.find((c) => c.url.includes('/recbutton') && c.method === 'POST');
    expect(rec?.body).toContain('start');
    // Regression: body requests MUST send Content-Length. Without it node:http uses chunked
    // transfer-encoding, which the camera rejects ("400 Illegal request header").
    expect(rec?.headers['content-length']).toBe(String(Buffer.byteLength(rec!.body!)));
    expect(drv.getState().record.recording).toBe(true);

    // iris 400 must PUT the original advertised string 'f4.0', not '400'.
    await drv.setControl('iris', 400);
    const av = calls.find((c) => c.url.includes('/shooting/settings/av') && c.method === 'PUT');
    expect(av?.body).toContain('f4.0');

    // shutter 50 -> '1/50'.
    await drv.setControl('shutter', 50);
    const tv = calls.find((c) => c.url.includes('/shooting/settings/tv') && c.method === 'PUT');
    expect(tv?.body).toContain('1/50');

    await drv.stopRecording();
    expect(drv.getState().record.recording).toBe(false);
  });

  it('goes to error status when the host is not reachable / not CCAPI', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.spyOn(https, 'request').mockImplementation((() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const req: any = new EventEmitter();
      req.write = () => {};
      req.destroy = () => {};
      req.end = () => { queueMicrotask(() => req.emit('error', new Error('ECONNREFUSED'))); };
      return req;
    }) as unknown as typeof https.request);
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9' }, { pollMs: 100000 });
    await drv.connect();
    expect(drv.status).toBe('error');
    expect(drv.getState().lastError).toBeTruthy();
  });
});
