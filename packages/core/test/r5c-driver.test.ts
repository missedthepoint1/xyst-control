import { describe, it, expect, afterEach, vi } from 'vitest';
import { R5CBrowserRemoteDriver } from '../src/r5c/driver.js';
import type { R5CEndpoints } from '../src/r5c/endpoints.js';

let drv: R5CBrowserRemoteDriver;
const realFetch = globalThis.fetch;
afterEach(async () => { await drv?.disconnect(); globalThis.fetch = realFetch; });

describe('R5CBrowserRemoteDriver (stub)', () => {
  it('exposes the CameraDriver shape and a clear not-implemented status', async () => {
    drv = new R5CBrowserRemoteDriver({ id: 'r5c-1', name: 'R5 C', driver: 'r5c', host: '10.0.0.9' });
    expect(drv.id).toBe('r5c-1');
    expect(drv.status).toBe('disconnected');
    await drv.connect();
    const s = drv.getState();
    expect(s.status).toBe('error');
    expect(s.lastError).toMatch(/endpoints/i);
  });

  it('rejects control actions with a pending-capture error', async () => {
    drv = new R5CBrowserRemoteDriver({ id: 'r5c-1', name: 'R5 C', driver: 'r5c', host: '10.0.0.9' });
    await expect(drv.startRecording()).rejects.toThrow(/Phase 4|endpoints/i);
    await expect(drv.setControl('iso', 800)).rejects.toThrow(/Phase 4|endpoints/i);
  });

  it('drives a (mocked) camera once endpoints are filled in', async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), method: init?.method ?? 'GET', body: init?.body as string | undefined });
      return new Response(JSON.stringify({ rec: false, iso: 800 }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;

    const endpoints: R5CEndpoints = {
      login: null,
      status: { method: 'GET', path: '/api/status' },
      recordStart: { method: 'POST', path: '/api/rec', body: { action: 'start' } },
      recordStop: { method: 'POST', path: '/api/rec', body: { action: 'stop' } },
      liveView: null,
      control: (id, value) => (id === 'iso' ? { method: 'POST', path: '/api/iso', body: { value } } : null),
      touchAf: null,
    };
    const parseStatus = (raw: string) => {
      const j = JSON.parse(raw) as { rec: boolean; iso: number };
      return { record: { recording: j.rec }, controls: { iso: { id: 'iso' as const, available: true, value: j.iso } } };
    };

    drv = new R5CBrowserRemoteDriver(
      { id: 'r5c-1', name: 'R5 C', driver: 'r5c', host: '10.0.0.9' },
      { endpoints, parseStatus, pollMs: 100000 },
    );
    await drv.connect();
    expect(drv.status).toBe('connected');
    expect(drv.getState().controls.iso?.value).toBe(800);
    expect(calls.some((c) => c.url.includes('/api/status'))).toBe(true);

    await drv.startRecording();
    const rec = calls.find((c) => c.url.includes('/api/rec') && c.method === 'POST');
    expect(rec).toBeTruthy();

    await drv.setControl('iso', 1600);
    expect(calls.some((c) => c.url.includes('/api/iso') && c.method === 'POST')).toBe(true);
  });
});
