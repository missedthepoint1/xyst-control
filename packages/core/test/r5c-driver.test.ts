import { describe, it, expect, afterEach } from 'vitest';
import { R5CBrowserRemoteDriver } from '../src/r5c/driver.js';

let drv: R5CBrowserRemoteDriver;
afterEach(async () => { await drv?.disconnect(); });

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
});
