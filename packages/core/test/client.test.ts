import { describe, it, expect, afterEach } from 'vitest';
import { FakeCamera } from './fake-camera.js';
import { xcRequest } from '../src/xc/client.js';
import { LivescopeError } from '../src/xc/errors.js';

let cam: FakeCamera;
afterEach(() => cam?.close());

describe('xcRequest', () => {
  it('GETs info.cgi and returns the parsed map', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const { map } = await xcRequest(host, 'info.cgi');
    expect(map['c.1.type']).toBe('Canon EOS C300 Mark III');
  });

  it('sends control.cgi params and reflects them back', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    await xcRequest(host, 'control.cgi', { 'f.rec': 'on' });
    const { map } = await xcRequest(host, 'info.cgi');
    expect(map['f.rec.status']).toBe('rec');
  });

  it('retries a flaky connection then succeeds', async () => {
    cam = new FakeCamera({ failFirst: 2 });
    const host = await cam.listen();
    const { map } = await xcRequest(host, 'info.cgi', {}, { retries: 3, timeoutMs: 1000 });
    expect(map['c.1.type']).toBeDefined();
  });

  it('performs Digest auth on a 401 challenge', async () => {
    cam = new FakeCamera({ auth: { username: 'admin', password: 'secret' } });
    const host = await cam.listen();
    const { map } = await xcRequest(host, 'info.cgi', {}, {
      auth: { username: 'admin', password: 'secret' },
    });
    expect(map['c.1.type']).toBeDefined();
  });

  it('throws AuthError (non-retryable) on 401 when no credentials are given', async () => {
    cam = new FakeCamera({ auth: { username: 'admin', password: 'secret' } });
    const host = await cam.listen();
    const { AuthError } = await import('../src/xc/errors.js');
    await expect(xcRequest(host, 'info.cgi')).rejects.toBeInstanceOf(AuthError);
  });

  it('throws LivescopeError on a non-zero livescope status', async () => {
    const { createServer } = await import('node:http');
    const srv = createServer((_req, res) => {
      res.writeHead(200, { 'livescope-status': '403' });
      res.end('');
    });
    await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
    const addr = srv.address() as import('node:net').AddressInfo;
    await expect(xcRequest(`127.0.0.1:${addr.port}`, 'control.cgi', { x: '1' }))
      .rejects.toBeInstanceOf(LivescopeError);
    srv.close();
  });

  it('xcRequestBinary fetches image bytes', async () => {
    const { xcRequestBinary } = await import('../src/xc/client.js');
    cam = new FakeCamera();
    const host = await cam.listen();
    const frame = await xcRequestBinary(host, 'image.cgi');
    expect(frame.contentType).toBe('image/jpeg');
    expect(frame.data[0]).toBe(0xff);
    expect(frame.data[1]).toBe(0xd8);
  });
});
