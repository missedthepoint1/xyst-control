import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { XystApiClient } from '../src/api.js';

let srv: Server;
const log: Array<{ method: string; url: string; body: string }> = [];
afterEach(() => { srv?.close(); log.length = 0; });

async function fakeApi(): Promise<string> {
  srv = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      log.push({ method: req.method!, url: req.url!, body: Buffer.concat(chunks).toString() });
      if (req.url === '/api/cameras') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify([{ id: 'cam-1', name: 'C300', status: 'connected',
          model: 'Canon EOS C300 Mark III', record: { recording: false }, controls: {} }]));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  return `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
}

describe('XystApiClient', () => {
  it('getCameras fetches the camera list', async () => {
    const api = new XystApiClient(await fakeApi());
    const cams = await api.getCameras();
    expect(cams[0]?.id).toBe('cam-1');
  });

  it('record start/stop hit the right routes', async () => {
    const api = new XystApiClient(await fakeApi());
    await api.recordStart('cam-1');
    await api.recordStop('cam-1');
    await api.recordAll(true);
    expect(log.map((l) => `${l.method} ${l.url}`)).toEqual([
      'POST /api/cameras/cam-1/record/start',
      'POST /api/cameras/cam-1/record/stop',
      'POST /api/record/start',
    ]);
  });

  it('setControl posts the value', async () => {
    const api = new XystApiClient(await fakeApi());
    await api.setControl('cam-1', 'iso', 1600);
    expect(log[0]?.url).toBe('/api/cameras/cam-1/controls/iso');
    expect(JSON.parse(log[0]!.body)).toEqual({ value: 1600 });
  });

  it('recallPreset by global id', async () => {
    const api = new XystApiClient(await fakeApi());
    await api.recallPreset('preset-9');
    expect(log[0]?.url).toBe('/api/presets/preset-9/recall');
  });
});
