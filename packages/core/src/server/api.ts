import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { CameraManager } from '../manager.js';
import type { CameraState, ControlId } from '../types.js';
import { Router, type Ctx } from './router.js';

const CONTROL_IDS: ControlId[] = ['iso', 'gain', 'shutter', 'shutterMode', 'shutterAngle', 'iris', 'wb', 'wbKelvin', 'nd', 'focus', 'faceDetect', 'colorbar', 'isoAuto', 'ndExtended', 'wbCC', 'awbHold', 'wbAction', 'afMode', 'afSpeed', 'afResponse', 'afLock', 'focusAction', 'osdOutput'];

function statusSummary(s: CameraState) {
  const controls: Record<string, string | number | undefined> = {};
  for (const id of CONTROL_IDS) controls[id] = s.controls[id]?.value;
  return { id: s.id, name: s.name, status: s.status, model: s.model,
    recording: s.record.recording, controls };
}

export interface ApiServerOptions { sse?: boolean }

export function createApiServer(mgr: CameraManager, _opts: ApiServerOptions = {}): Server {
  // Each SSE client registers 3 manager listeners; lift Node's 10-listener warning cap.
  mgr.setMaxListeners(0);

  const router = new Router();

  router.add('GET', '/api/health', () => ({ ok: true }));
  router.add('GET', '/api/cameras', () => mgr.getAllStates());
  router.add('GET', '/api/cameras/:id', ({ params }) => required(mgr.getState(params.id!)));
  router.add('GET', '/api/cameras/:id/status', ({ params }) =>
    statusSummary(required(mgr.getState(params.id!))));

  router.add('POST', '/api/cameras/:id/record/start', ({ params }) => mgr.startRecording(params.id!).then(ok));
  router.add('POST', '/api/cameras/:id/record/stop', ({ params }) => mgr.stopRecording(params.id!).then(ok));
  router.add('POST', '/api/record/start', () => mgr.recordAll(true).then(ok));
  router.add('POST', '/api/record/stop', () => mgr.recordAll(false).then(ok));

  router.add('POST', '/api/cameras/:id/controls/:control', async ({ params, body }) => {
    const control = params.control as ControlId;
    if (!CONTROL_IDS.includes(control)) throw new HttpError(400, `unknown control ${control}`);
    const value = (body as { value?: string | number | null })?.value;
    if (value === undefined || value === null) throw new HttpError(400, 'body.value required');
    await mgr.setControl(params.id!, control, value);
    return ok();
  });

  router.add('POST', '/api/cameras/:id/controls/:control/step', async ({ params, body }) => {
    const control = params.control as ControlId;
    if (!CONTROL_IDS.includes(control)) throw new HttpError(400, `unknown control ${control}`);
    const dir = (body as { dir?: number })?.dir ?? 1;
    if (dir !== 1 && dir !== -1) throw new HttpError(400, 'body.dir must be 1 or -1');
    await mgr.stepControl(params.id!, control, dir);
    return ok();
  });

  router.add('GET', '/api/cameras/:id/presets', ({ params }) => {
    required(mgr.getState(params.id!));
    return mgr.listPresets(params.id!);
  });
  router.add('POST', '/api/cameras/:id/presets', ({ params, body }) => {
    const name = (body as { name?: string })?.name;
    if (!name) throw new HttpError(400, 'body.name required');
    return mgr.savePreset(params.id!, name);
  });
  router.add('POST', '/api/cameras/:id/presets/:presetId/recall', ({ params }) =>
    mgr.recallPreset(params.id!, params.presetId!).then(ok));
  router.add('POST', '/api/presets/:presetId/recall', ({ params }) =>
    mgr.recallPresetById(params.presetId!).then(ok));
  router.add('DELETE', '/api/cameras/:id/presets/:presetId', ({ params }) =>
    mgr.deletePreset(params.id!, params.presetId!).then(ok));
  router.add('DELETE', '/api/cameras/:id', ({ params }) => mgr.removeCamera(params.id!).then(ok));

  router.add('POST', '/api/cameras/:id/focus', async ({ params, body }) => {
    const b = body as { x?: number; y?: number };
    if (typeof b?.x !== 'number' || typeof b?.y !== 'number') throw new HttpError(400, 'body.x and body.y (0..1) required');
    await mgr.setFocusPoint(params.id!, b.x, b.y);
    return ok();
  });

  router.add('GET', '/api/cameras/:id/focus-points', ({ params }) => mgr.listFocusPoints(params.id!));
  router.add('POST', '/api/cameras/:id/focus-points', ({ params, body }) => {
    const b = body as { name?: string; x?: number; y?: number };
    if (!b?.name || typeof b.x !== 'number' || typeof b.y !== 'number') throw new HttpError(400, 'body.name, x, y required');
    return mgr.saveFocusPoint(params.id!, b.name, b.x, b.y);
  });
  router.add('POST', '/api/cameras/:id/focus-points/:pointId/recall', ({ params }) =>
    mgr.recallFocusPoint(params.id!, params.pointId!).then(ok));
  router.add('POST', '/api/focus-points/:pointId/recall', ({ params }) =>
    mgr.recallFocusPointById(params.pointId!).then(ok));
  router.add('DELETE', '/api/cameras/:id/focus-points/:pointId', ({ params }) =>
    mgr.deleteFocusPoint(params.id!, params.pointId!).then(ok));

  router.add('GET', '/api/cameras/:id/meta', ({ params }) =>
    mgr.getMeta(params.id!).then((m) => m ?? { detect: [] }));

  router.add('GET', '/api/cameras/:id/preview.jpg', async ({ params, res }) => {
    const frame = await mgr.getPreview(params.id!);
    if (!frame) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: 'no preview' })); return; }
    res.writeHead(200, { 'content-type': frame.contentType, 'cache-control': 'no-store', 'access-control-allow-origin': '*' });
    res.end(Buffer.from(frame.data));
  });

  // App-level "show OSD on the multiview feeds" toggle (shared by the popout + Companion).
  router.add('GET', '/api/osd', () => ({ osd: mgr.getOsd() }));
  router.add('POST', '/api/osd', async ({ body }) => {
    const b = (body ?? {}) as { value?: boolean; toggle?: boolean };
    const value = b.toggle ? !mgr.getOsd() : !!b.value;
    await mgr.setOsd(value);
    return { osd: value };
  });

  router.add('GET', '/api/events', ({ req, res }) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write('event: hello\ndata: {}\n\n');
    sse(res, 'osd', { osd: mgr.getOsd() }); // initial app-level state
    const onState = (id: string, s: unknown) => sse(res, 'state', { cameraId: id, state: s });
    const onStatus = (id: string, st: unknown) => sse(res, 'status', { cameraId: id, status: st });
    const onPresets = (id: string, p: unknown) => sse(res, 'presets', { cameraId: id, presets: p });
    const onFocusPoints = (id: string, pts: unknown) => sse(res, 'focusPoints', { cameraId: id, focusPoints: pts });
    const onOsd = (v: unknown) => sse(res, 'osd', { osd: v });
    mgr.on('state', onState);
    mgr.on('status', onStatus);
    mgr.on('presets', onPresets);
    mgr.on('focusPoints', onFocusPoints);
    mgr.on('osd', onOsd);
    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      mgr.off('state', onState);
      mgr.off('status', onStatus);
      mgr.off('presets', onPresets);
      mgr.off('focusPoints', onFocusPoints);
      mgr.off('osd', onOsd);
    });
    return undefined; // streaming response managed here; handle() must not double-send
  });

  return createServer((req, res) => void handle(router, req, res));
}

function ok() { return { ok: true }; }
function required<T>(v: T | undefined): T {
  if (v === undefined) throw new HttpError(404, 'not found');
  return v;
}

class HttpError extends Error { constructor(readonly code: number, msg: string) { super(msg); } }

async function handle(router: Router, req: IncomingMessage, res: ServerResponse): Promise<void> {
  cors(res);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? '/', 'http://x');
  const m = router.match(req.method ?? 'GET', url.pathname);
  if (!m) return send(res, 404, { error: 'not found' });
  try {
    const body = await readJson(req);
    const ctx: Ctx = { req, res, params: m.params, body };
    const result = await m.handler(ctx);
    if (!res.headersSent && !res.writableEnded) send(res, 200, result ?? { ok: true });
  } catch (err) {
    const code = err instanceof HttpError ? err.code : 500;
    if (!res.headersSent && !res.writableEnded) {
      send(res, code, { error: err instanceof Error ? err.message : String(err) });
    }
  }
}

function cors(res: ServerResponse): void {
  res.setHeader('access-control-allow-origin', '*');
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type');
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.method === 'GET' || req.method === 'DELETE') return undefined;
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (chunks.length === 0) return undefined;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'invalid JSON body'); }
}

function send(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

function sse(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
