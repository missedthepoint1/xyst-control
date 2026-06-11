import { describe, it, expect, afterEach, vi } from 'vitest';
import { CcapiDriver } from '../src/ccapi/driver.js';

let drv: CcapiDriver;
const realFetch = globalThis.fetch;
afterEach(async () => { await drv?.disconnect(); globalThis.fetch = realFetch; });

const SETTINGS = {
  iso: { value: '800', ability: ['auto', '100', '200', '400', '800', '1600'] },
  tv: { value: '1/100', ability: ['1/50', '1/100', '1/200'] },
  av: { value: 'f4.0', ability: ['f2.8', 'f4.0', 'f5.6'] },
  wb: { value: 'auto', ability: ['auto', 'daylight', 'shade'] },
  colortemperature: { value: 5200, ability: { min: 2500, max: 10000, step: 100 } },
  shootingmode: { value: 'm' },
};

type Call = { url: string; method: string; body?: string };

function mockCamera(): Call[] {
  const calls: Call[] = [];
  const json = (o: unknown) => new Response(JSON.stringify(o), { status: 200, headers: { 'content-type': 'application/json' } });
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, method: init?.method ?? 'GET', body: init?.body as string | undefined });
    if (u.endsWith('/ccapi')) return json({ ver100: [] });
    if (u.includes('/shooting/settings/')) return json({}); // PUT a single setting
    if (u.includes('/shooting/settings')) return json(SETTINGS);
    if (u.includes('/deviceinformation')) return json({ productname: 'Canon EOS R6 Mark III' });
    if (u.includes('/devicestatus/battery')) return json({ level: 85, kind: 'battery' });
    if (u.includes('/recbutton')) return json({});
    return json({});
  }) as typeof fetch;
  return calls;
}

describe('CcapiDriver', () => {
  it('connects and capability-discovers controls from shooting/settings', async () => {
    mockCamera();
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9:8080' }, { pollMs: 100000 });
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
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9:8080' }, { pollMs: 100000 });
    await drv.connect();

    await drv.startRecording();
    const rec = calls.find((c) => c.url.includes('/recbutton') && c.method === 'POST');
    expect(rec?.body).toContain('start');
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
    globalThis.fetch = vi.fn(async () => { throw new Error('ECONNREFUSED'); }) as typeof fetch;
    drv = new CcapiDriver({ id: 'r6-1', name: 'R6 III', driver: 'ccapi', host: '10.0.0.9:8080' }, { pollMs: 100000 });
    await drv.connect();
    expect(drv.status).toBe('error');
    expect(drv.getState().lastError).toBeTruthy();
  });
});
