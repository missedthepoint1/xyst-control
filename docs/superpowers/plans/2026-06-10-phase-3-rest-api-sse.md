# XYST CONTROL — Phase 3 (local REST API + SSE state stream) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Expose every camera action and live state over a local HTTP API so Bitfocus Companion's Generic HTTP instance (and any client) can drive the app with no custom module — record start/stop per-camera and globally, set ISO/shutter/iris/WB/ND, list/save/recall/delete presets, read status, and subscribe to real-time state via SSE. Plus: driver-selection-by-type and a clearly-separated R5 C stub driver (Phase 4 prep).

**Architecture:** The HTTP server lives in `@xyst/core` (`createApiServer(manager)` → a Node `http.Server`), wrapping the SAME `CameraManager` the Electron IPC already uses — one command layer, no duplicated camera logic (architecture rule 4). Dependency-free: Node's built-in `http` + a tiny router; SSE (`text/event-stream`) for the live state push. The Electron main process starts the server alongside the window. Fully testable without hardware against the existing `FakeCamera`.

**Tech Stack:** TypeScript, Node `http`, Vitest (integration tests drive the server via `fetch` against a `FakeCamera`-backed manager). No new runtime deps.

**Spec source:** kickoff §3 Stage 1 (local REST API + state stream, predictable routes for Companion Generic HTTP).

---

## Conventions
- TDD for all core work (Tasks 1–5). Commit per task. `git -c user.name='XYST' -c user.email='zak@xyst.la' commit`.
- Tests: `pnpm --filter @xyst/core test`. Typecheck: `pnpm --filter @xyst/core typecheck` / `pnpm --filter @xyst/app typecheck`.
- Branch: continue on `phase-1`.

---

## API surface (final)

All JSON. Errors → `{ error: string }` with 4xx/5xx. Permissive CORS (localhost tool).

| Method | Path | Action |
|---|---|---|
| GET | `/api/health` | `{ ok: true }` |
| GET | `/api/cameras` | array of full `CameraState` |
| GET | `/api/cameras/:id` | one `CameraState` (404 if unknown) |
| GET | `/api/cameras/:id/status` | Companion-friendly subset: `{ id, name, status, recording, model, controls: {iso,shutter,iris,wb,wbKelvin,nd: value} }` |
| POST | `/api/cameras/:id/record/start` | start recording |
| POST | `/api/cameras/:id/record/stop` | stop recording |
| POST | `/api/record/start` | REC ALL |
| POST | `/api/record/stop` | STOP ALL |
| POST | `/api/cameras/:id/controls/:control` | body `{ "value": <string\|number> }` → setControl (`control` ∈ iso,gain,shutter,iris,wb,wbKelvin,nd) |
| GET | `/api/cameras/:id/presets` | array of `CameraPreset` |
| POST | `/api/cameras/:id/presets` | body `{ "name": string }` → save current as preset; returns the preset |
| POST | `/api/cameras/:id/presets/:presetId/recall` | recall (explicit) |
| POST | `/api/presets/:presetId/recall` | recall by UUID across cameras (Companion-friendly; kickoff route) |
| DELETE | `/api/cameras/:id/presets/:presetId` | delete preset |
| GET | `/api/events` | SSE stream; events `state`, `status`, `presets`, each `data: {cameraId, ...}` |

---

## File structure (changes)

```
packages/core/src/
  errors.ts                    # + NotImplementedError (or reuse)         (Task 1)
  r5c/driver.ts                # NEW R5CBrowserRemoteDriver stub           (Task 1)
  manager.ts                   # driver-selection by profile.driver; recallPresetById (Tasks 1-2)
  server/
    router.ts                  # NEW tiny method+path router               (Task 3)
    api.ts                     # NEW createApiServer(manager)              (Tasks 3-4)
  index.ts                     # export createApiServer, R5CBrowserRemoteDriver
packages/core/test/
    r5c-driver.test.ts  manager-presetById.test.ts  api.test.ts  api-sse.test.ts
packages/app/src/main/
    index.ts                   # start the API server with the manager     (Task 5)
    api-port.ts                # resolve port (env XYST_API_PORT, default 8088)
```

---

## Task 1: R5 C stub driver + driver selection by type

**Files:** create `packages/core/src/r5c/driver.ts`; modify `packages/core/src/manager.ts`; create `packages/core/test/r5c-driver.test.ts`

- [ ] **Step 1: Failing test** — `packages/core/test/r5c-driver.test.ts`
```ts
import { describe, it, expect, afterEach } from 'vitest';
import { R5CBrowserRemoteDriver } from '../src/r5c/driver.js';

let drv: R5CBrowserRemoteDriver;
afterEach(async () => { await drv?.disconnect(); });

describe('R5CBrowserRemoteDriver (stub)', () => {
  it('exposes the CameraDriver shape and a clear not-implemented status', async () => {
    drv = new R5CBrowserRemoteDriver({ id: 'r5c-1', name: 'R5 C', driver: 'r5c', host: '10.0.0.9' });
    expect(drv.id).toBe('r5c-1');
    expect(drv.status).toBe('disconnected');
    await drv.connect(); // must not throw; goes to error with a clear message
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
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @xyst/core test r5c`

- [ ] **Step 3: Implement** — `packages/core/src/r5c/driver.ts`
```ts
import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type { CameraProfile, CameraState, ConnectionStatus, ControlId, ControlSettings } from '../types.js';

/**
 * Canon EOS R5 C — Browser Remote HTTP driver. STUB until the undocumented
 * endpoints are captured (kickoff Phase 4). Endpoint map below is to be filled
 * from a dev-tools HAR capture. Every action throws a clear pending error rather
 * than guessing, so the app never silently misbehaves against a real R5 C.
 */
export const R5C_ENDPOINTS = {
  // Fill these from the captured Browser Remote requests (Phase 4):
  recordStart: null as string | null,
  recordStop: null as string | null,
  setIso: null as string | null,
  setShutter: null as string | null,
  setIris: null as string | null,
  setWb: null as string | null,
  touchAf: null as string | null, // normalized x/y → AF (Phase 6)
  liveView: null as string | null,
  status: null as string | null,
} as const;

const PENDING = 'R5 C Browser Remote endpoints pending capture (Phase 4)';

export class R5CBrowserRemoteDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private lastError?: string;

  constructor(private profile: CameraProfile) {
    super();
    this.id = profile.id;
    this.on('error', () => {});
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    return {
      id: this.id,
      name: this.profile.name,
      status: this._status,
      updatedAt: 0,
      lastError: this.lastError,
      record: { recording: false },
      controls: {},
    };
  }

  async connect(): Promise<void> {
    this.lastError = PENDING;
    this.setStatus('error');
  }
  async disconnect(): Promise<void> { this.setStatus('disconnected'); }

  async startRecording(): Promise<void> { throw new Error(PENDING); }
  async stopRecording(): Promise<void> { throw new Error(PENDING); }
  async setControl(_id: ControlId, _v: string | number): Promise<void> { throw new Error(PENDING); }
  async applySettings(_s: ControlSettings): Promise<void> { throw new Error(PENDING); }

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }
}
```

- [ ] **Step 4: Wire driver selection in `packages/core/src/manager.ts`.** Add the import:
```ts
import { R5CBrowserRemoteDriver } from './r5c/driver.js';
```
Replace the body of `makeDriver` so it picks by `profile.driver`:
```ts
  private makeDriver(profile: CameraProfile): void {
    if (this.drivers.has(profile.id)) return;
    const driver: CameraDriver = profile.driver === 'r5c'
      ? new R5CBrowserRemoteDriver(profile)
      : new XCProtocolDriver(profile, this.driverOpts);
    driver.on('state', (s) => this.emit('state', profile.id, s));
    driver.on('status', (st) => this.emit('status', profile.id, st));
    driver.on('error', (e) => this.emit('camera-error', profile.id, e));
    this.drivers.set(profile.id, driver);
  }
```

- [ ] **Step 5: Run + typecheck.** `pnpm --filter @xyst/core test` (r5c green, existing green), `pnpm --filter @xyst/core typecheck` (zero errors).

- [ ] **Step 6: Commit**
```bash
git add packages/core/src/r5c packages/core/src/manager.ts packages/core/test/r5c-driver.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): R5 C stub driver + driver selection by profile type"
```

---

## Task 2: `recallPresetById` across cameras

**Files:** modify `packages/core/src/manager.ts`; modify `packages/core/test/manager.test.ts`

- [ ] **Step 1: Failing test** — append inside `describe('CameraManager', ...)`:
```ts
  it('recalls a preset by its (global) id across cameras', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'X');
    await mgr.setControl('cam-1', 'nd', 1600);
    await mgr.recallPresetById(preset.id);
    expect(cam.controlLog.at(-1)).toContain('c.1.nd.filter=0'); // fixture nd=400? -> recalled to saved
  });

  it('throws for an unknown preset id', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await expect(mgr.recallPresetById('nope')).rejects.toThrow(/preset/i);
  });
```
> Note: the fixture's ND is `400`; a preset saved at connect captures `nd:400`. After `setControl('nd',1600)`, recall restores ND to `400`. Adjust the assertion to `c.1.nd.filter=400` to match the saved value. (Use the value the fixture actually advertises.)

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** in `manager.ts`:
```ts
  async recallPresetById(presetId: string): Promise<void> {
    for (const [cameraId, profile] of this.profiles) {
      if ((profile.presets ?? []).some((p) => p.id === presetId)) {
        return this.recallPreset(cameraId, presetId);
      }
    }
    throw new Error(`no preset with id ${presetId}`);
  }
```

- [ ] **Step 4: Fix the test's expected ND value** to the fixture's (`c.1.nd.filter=400`). Run, confirm PASS.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/manager.ts packages/core/test/manager.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): recallPresetById (global preset lookup for the API)"
```

---

## Task 3: Tiny router + REST API (no SSE yet)

**Files:** create `packages/core/src/server/router.ts`, `packages/core/src/server/api.ts`; create `packages/core/test/api.test.ts`

- [ ] **Step 1: Router** — `packages/core/src/server/router.ts`
```ts
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface Ctx {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  body: unknown;
}
export type Handler = (ctx: Ctx) => unknown | Promise<unknown>;

interface Route { method: string; parts: string[]; handler: Handler }

export class Router {
  private routes: Route[] = [];
  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, parts: pattern.split('/').filter(Boolean), handler });
  }
  match(method: string, path: string): { handler: Handler; params: Record<string, string> } | null {
    const segs = path.split('/').filter(Boolean);
    for (const r of this.routes) {
      if (r.method !== method || r.parts.length !== segs.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      for (let i = 0; i < r.parts.length; i++) {
        const p = r.parts[i]!;
        const s = segs[i]!;
        if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(s);
        else if (p !== s) { ok = false; break; }
      }
      if (ok) return { handler: r.handler, params };
    }
    return null;
  }
}
```

- [ ] **Step 2: Failing test** — `packages/core/test/api.test.ts`
```ts
import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

let cam: FakeCamera;
let mgr: CameraManager;
let server: import('node:http').Server;
let base: string;

afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await mgr?.disconnectAll();
  await cam?.close();
});

async function setup(): Promise<void> {
  cam = new FakeCamera();
  const host = await cam.listen();
  const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
  const file = join(dir, 'cameras.json');
  writeFileSync(file, JSON.stringify({ cameras: [{ id: 'cam-1', name: 'C300', driver: 'xc', host }] }));
  mgr = new CameraManager(file, { pollMs: 50 });
  await mgr.load();
  await mgr.connect('cam-1');
  server = createApiServer(mgr);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('REST API', () => {
  it('GET /api/health', async () => {
    await setup();
    const res = await fetch(`${base}/api/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it('GET /api/cameras returns states', async () => {
    await setup();
    const cams = await (await fetch(`${base}/api/cameras`)).json();
    expect(cams[0].id).toBe('cam-1');
    expect(cams[0].model).toBe('Canon EOS C300 Mark III');
  });

  it('GET /api/cameras/:id/status returns a flat summary', async () => {
    await setup();
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(false);
    expect(st.controls.iso).toBe(800);
  });

  it('POST record/start then status shows recording', async () => {
    await setup();
    const r = await fetch(`${base}/api/cameras/cam-1/record/start`, { method: 'POST' });
    expect(r.status).toBe(200);
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(true);
  });

  it('POST a control sets it', async () => {
    await setup();
    await fetch(`${base}/api/cameras/cam-1/controls/iso`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 1600 }),
    });
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.controls.iso).toBe(1600);
  });

  it('save then recall a preset by global id', async () => {
    await setup();
    const preset = await (await fetch(`${base}/api/cameras/cam-1/presets`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Look' }),
    })).json();
    expect(preset.name).toBe('Look');
    const recall = await fetch(`${base}/api/presets/${preset.id}/recall`, { method: 'POST' });
    expect(recall.status).toBe(200);
  });

  it('404 for unknown camera', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras/nope`)).status).toBe(404);
  });

  it('REC ALL / STOP ALL', async () => {
    await setup();
    expect((await fetch(`${base}/api/record/start`, { method: 'POST' })).status).toBe(200);
    const st = await (await fetch(`${base}/api/cameras/cam-1/status`)).json();
    expect(st.recording).toBe(true);
    await fetch(`${base}/api/record/stop`, { method: 'POST' });
  });
});
```

- [ ] **Step 3: Run, confirm FAIL** (no api.js). `pnpm --filter @xyst/core test api`

- [ ] **Step 4: Implement** — `packages/core/src/server/api.ts`
```ts
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import type { CameraManager } from '../manager.js';
import type { CameraState, ControlId } from '../types.js';
import { Router, type Ctx } from './router.js';

const CONTROL_IDS: ControlId[] = ['iso', 'gain', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];

function statusSummary(s: CameraState) {
  const controls: Record<string, string | number | undefined> = {};
  for (const id of CONTROL_IDS) controls[id] = s.controls[id]?.value;
  return { id: s.id, name: s.name, status: s.status, model: s.model,
    recording: s.record.recording, controls };
}

export interface ApiServerOptions { sse?: boolean }

export function createApiServer(mgr: CameraManager, _opts: ApiServerOptions = {}): Server {
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
    const value = (body as { value?: string | number })?.value;
    if (value === undefined) throw new HttpError(400, 'body.value required');
    await mgr.setControl(params.id!, control, value);
    return ok();
  });

  router.add('GET', '/api/cameras/:id/presets', ({ params }) => mgr.listPresets(params.id!));
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
    if (!res.writableEnded) send(res, 200, result ?? { ok: true });
  } catch (err) {
    const code = err instanceof HttpError ? err.code : 500;
    send(res, code, { error: err instanceof Error ? err.message : String(err) });
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
```

- [ ] **Step 5: Export from `packages/core/src/index.ts`** — add:
```ts
export { createApiServer } from './server/api.js';
export { R5CBrowserRemoteDriver } from './r5c/driver.js';
```

- [ ] **Step 6: Run, confirm PASS** (api tests green). Then full suite + typecheck green.

- [ ] **Step 7: Commit**
```bash
git add packages/core/src/server packages/core/src/index.ts packages/core/test/api.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): local REST API over the CameraManager command layer"
```

---

## Task 4: SSE live state stream (`GET /api/events`)

**Files:** modify `packages/core/src/server/api.ts`; create `packages/core/test/api-sse.test.ts`

- [ ] **Step 1: Failing test** — `packages/core/test/api-sse.test.ts`
```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

let cam: FakeCamera; let mgr: CameraManager; let server: import('node:http').Server; let base: string;
afterEach(async () => {
  await new Promise<void>((r) => server?.close(() => r()));
  await mgr?.disconnectAll(); await cam?.close();
});

describe('SSE /api/events', () => {
  it('streams a state event when the camera records', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
    const file = join(dir, 'cameras.json');
    writeFileSync(file, JSON.stringify({ cameras: [{ id: 'cam-1', name: 'C', driver: 'xc', host }] }));
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load(); await mgr.connect('cam-1');
    server = createApiServer(mgr);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    const ctrl = new AbortController();
    const seen: string[] = [];
    const reading = (async () => {
      const res = await fetch(`${base}/api/events`, { signal: ctrl.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          seen.push(dec.decode(value, { stream: true }));
        }
      } catch { /* aborted */ }
    })();

    await new Promise((r) => setTimeout(r, 100));
    await fetch(`${base}/api/cameras/cam-1/record/start`, { method: 'POST' });
    await vi.waitFor(() => expect(seen.join('')).toMatch(/event: state/), { timeout: 2000 });
    expect(seen.join('')).toMatch(/"recording":true/);
    ctrl.abort();
    await reading;
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement SSE in `api.ts`.** Add an events route + the SSE plumbing. Register before returning the server:
```ts
  router.add('GET', '/api/events', ({ req, res }) => {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'access-control-allow-origin': '*',
    });
    res.write('event: hello\ndata: {}\n\n');
    const onState = (id: string, s: unknown) => sse(res, 'state', { cameraId: id, state: s });
    const onStatus = (id: string, st: unknown) => sse(res, 'status', { cameraId: id, status: st });
    const onPresets = (id: string, p: unknown) => sse(res, 'presets', { cameraId: id, presets: p });
    mgr.on('state', onState);
    mgr.on('status', onStatus);
    mgr.on('presets', onPresets);
    const keepAlive = setInterval(() => { if (!res.writableEnded) res.write(': ping\n\n'); }, 15000);
    req.on('close', () => {
      clearInterval(keepAlive);
      mgr.off('state', onState);
      mgr.off('status', onStatus);
      mgr.off('presets', onPresets);
    });
    return undefined; // response is managed here (streaming); handler must not double-send
  });
```
Add the `sse` helper:
```ts
function sse(res: ServerResponse, event: string, data: unknown): void {
  if (res.writableEnded) return;
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}
```
**Important:** the generic `handle()` does `if (!res.writableEnded) send(res, 200, result ?? {ok:true})`. For SSE the handler keeps the response open and returns `undefined`, but `res` is NOT ended — so `handle` would wrongly send JSON. Fix `handle()` so it does not send when the response has already had headers written. Change the post-handler line to:
```ts
    const result = await m.handler(ctx);
    if (!res.headersSent && !res.writableEnded) send(res, 200, result ?? { ok: true });
```
(The SSE route calls `res.writeHead`, so `res.headersSent` is true → `handle` won't double-send.)

- [ ] **Step 4: Run, confirm PASS.** Run the api + sse tests 2–3× for stability. Full suite + typecheck green.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/server/api.ts packages/core/test/api-sse.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): SSE /api/events live state stream"
```

---

## Task 5: Start the API server in the Electron app

**Files:** create `packages/app/src/main/api-port.ts`; modify `packages/app/src/main/index.ts`

- [ ] **Step 1: `api-port.ts`**
```ts
export function resolveApiPort(): number {
  const raw = process.env.XYST_API_PORT;
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 8088;
}
```

- [ ] **Step 2: Start the server in `main/index.ts`.** Add imports:
```ts
import { CameraManager, createApiServer } from '@xyst/core';
import { resolveApiPort } from './api-port.js';
```
In `app.whenReady().then(async () => { ... })`, after `registerIpc(...)` and before/after `createWindow()`, start the API:
```ts
  const apiPort = resolveApiPort();
  const api = createApiServer(mgr);
  api.listen(apiPort, '127.0.0.1', () => console.log(`XYST API on http://127.0.0.1:${apiPort}`));
```
(Keep it simple; the server shares the same `mgr`. No teardown needed for Phase 3 — it dies with the app.)

- [ ] **Step 3: Verify** — `pnpm --filter @xyst/app typecheck` (zero errors), `pnpm --filter @xyst/app build` (clean).

- [ ] **Step 4: Smoke test against the sim** (no camera needed): with the sim camera running and the app launched (`pnpm dev`), from a shell:
```bash
curl -s http://127.0.0.1:8088/api/cameras | head -c 200
curl -s -X POST http://127.0.0.1:8088/api/cameras/sim-1/record/start
curl -s http://127.0.0.1:8088/api/cameras/sim-1/status
```
Expect JSON; record/start flips `recording` to true (also visible in the app window — proves the shared command layer). This is the Companion-equivalent path.

- [ ] **Step 5: Commit**
```bash
git add packages/app/src/main
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(app): start the local REST/SSE API server with the shared CameraManager"
```

---

## Task 6: Verify + docs

- [ ] **Step 1: Whole-monorepo green.** `pnpm -r test && pnpm -r typecheck && pnpm --filter @xyst/app build`.
- [ ] **Step 2: Update `CLAUDE.md`** — mark Phase 3 (REST API + SSE) implemented; add the route table summary + the SSE decision + the API port (8088, `XYST_API_PORT`) to the Decisions log; note the R5 C stub driver + driver-selection exist. Update README with the API routes and a Companion Generic HTTP example (`POST http://127.0.0.1:8088/api/cameras/<id>/record/start`).
- [ ] **Step 3: Commit docs.**
- [ ] **Step 4 (with hardware, later):** point Companion's Generic HTTP at the routes; confirm a Stream Deck button toggles REC with no custom module (kickoff Phase 3 gate). Rides with the Task 14 hardware session.

---

## Self-review notes (author)
- **Spec coverage (kickoff §3 Stage 1):** every camera action over REST (record per-camera + global, set controls, preset list/save/recall/delete), `GET /status`, real-time state via SSE, predictable routes for Companion Generic HTTP, shared command layer (`CameraManager`) — REST and the future Companion module both go through it, no duplicated logic. OSC listener was called "optional" in the kickoff and is deferred (note it). Native Companion module is Phase 7.
- **No hardware dependency:** the API + SSE are fully tested against `FakeCamera`; the only hardware step (Companion→Stream Deck) rides with the Phase 1/3 on-camera gate.
- **Type consistency:** `createApiServer(manager)` uses only existing `CameraManager` methods plus the new `recallPresetById`; `statusSummary` reads `CameraState`; control validation against `CONTROL_IDS` mirrors `ControlId`.
- **Robustness:** broadcast routes use the manager's `allSettled` semantics; SSE cleans up listeners + keepalive on disconnect; the generic handler guards against double-send for the streaming route.
- **Intended simplifications:** no auth on the local API (localhost tool, matches kickoff's "local REST API" framing — revisit if exposed beyond loopback); API bound to `127.0.0.1` only.
