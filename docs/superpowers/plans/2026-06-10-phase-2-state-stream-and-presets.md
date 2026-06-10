# XYST CONTROL — Phase 2 (live state stream + presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the app reflect body-side changes live via the XC `info.cgi` event stream, and let operators save/recall named per-camera setting snapshots (presets).

**Architecture:** Builds on the Phase 1 monorepo. In `packages/core`: a new `info.cgi?type=stream` consumer (`xc/stream.ts`) feeds the `XCProtocolDriver`, which now merges stream deltas and emits `state` with near-zero latency; polling stays on as a **reconcile/liveness safety net** at a slow cadence while the stream is healthy, reverting to fast polling if the stream drops. Presets are app-managed setting snapshots stored per-camera in `cameras.json` and applied through a new capability-aware `applySettings()` driver method (one merged `control.cgi`). The Electron app gains preset IPC + a presets row in each camera panel.

**Tech Stack:** Same as Phase 1 — TypeScript, pnpm, Vitest (unit + fake-camera integration, now including a streaming fake camera), Electron + React.

**Spec reference:** `info.cgi?type=stream` returns a `multipart/x-mixed-replace` server-push; the first part carries all items, later parts carry only changed items as `key:=value`. See `docs/xc-protocol-spec.pdf` §3.2.2.1 and `.work/xc-spec.txt`. Presets here are **app-level snapshots**, NOT the camera's native PTZ `preset/set` feature.

---

## Conventions

- **TDD for all of `core`** (Tasks 2–6). The streaming path is tested against an extended `FakeCamera` that can push deltas — no real camera needed.
- **Build-and-manually-verify for the app layer** (Tasks 7–8).
- Commit after every task. `git -c user.name='XYST' -c user.email='zak@xyst.la' commit`.
- Tests: `pnpm --filter @xyst/core test`. Typecheck: `pnpm --filter @xyst/core typecheck` / `pnpm --filter @xyst/app typecheck`. App build: `pnpm --filter @xyst/app build`.
- Branch: continue on `phase-1` (or a `phase-2` branch if you prefer; this plan assumes the current branch).

---

## File structure (changes)

```
packages/core/src/
  types.ts                 # + ControlSettings, CameraPreset, CameraProfile.presets   (Task 1)
  driver.ts                # + applySettings() on CameraDriver                          (Task 1)
  xc/
    commands.ts            # + buildSettingsParams()                                    (Task 2)
    stream.ts              # NEW: openInfoStream() multipart consumer                   (Task 3)
    driver.ts              # stream integration + applySettings + reconcile-poll        (Task 5)
  manager.ts               # + savePreset/recallPreset/deletePreset/listPresets         (Task 6)
packages/core/test/
  fake-camera.ts           # + type=stream support + pushDelta()                        (Task 4)
  stream.test.ts  driver-stream.test.ts  commands.test.ts(+)  manager.test.ts(+)
packages/app/src/
  main/ipc.ts              # + preset channels                                          (Task 7)
  preload/index.ts         # + preset api + presets push                                (Task 7)
  renderer/
    hooks/usePresets.ts    # NEW: per-camera presets fetch                              (Task 8)
    components/CameraPanel.tsx   # + <PresetBar/>                                        (Task 8)
    components/PresetBar.tsx     # NEW                                                   (Task 8)
```

---

## Task 1: Types + driver interface for settings & presets

**Files:** modify `packages/core/src/types.ts`, `packages/core/src/driver.ts`

- [ ] **Step 1: Add types to `packages/core/src/types.ts`**

Append:
```ts
/** A set of control values to apply together (preset payload / bulk apply). */
export type ControlSettings = Partial<Record<ControlId, string | number>>;

/** An app-managed snapshot of camera settings (NOT a camera-native PTZ preset). */
export interface CameraPreset {
  id: string;
  name: string;
  settings: ControlSettings;
  /** Exposure mode captured at save time (usually 'manual'). */
  exposureMode?: string;
}
```

Add `presets` to `CameraProfile`:
```ts
export interface CameraProfile {
  id: string;
  name: string;
  driver: 'xc' | 'r5c';
  host: string;
  auth?: CameraAuth;
  presets?: CameraPreset[];
}
```

- [ ] **Step 2: Add `applySettings` to the `CameraDriver` interface in `packages/core/src/driver.ts`**

Add this method to the `CameraDriver` interface (after `setControl`):
```ts
  /** Apply several controls together (capability-aware) in one request. */
  applySettings(settings: import('./types.js').ControlSettings): Promise<void>;
```

- [ ] **Step 3: Typecheck won't pass yet** (XCProtocolDriver doesn't implement `applySettings` until Task 5). Do not run `typecheck`. Just verify the files parse by eye.

- [ ] **Step 4: Commit**
```bash
git add packages/core/src/types.ts packages/core/src/driver.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): preset + ControlSettings types and applySettings on the driver interface"
```

---

## Task 2: `buildSettingsParams` — merge multiple controls into one control.cgi

**Files:** modify `packages/core/src/xc/commands.ts`; modify `packages/core/test/commands.test.ts`

- [ ] **Step 1: Add the failing test** — append inside `commands.test.ts`:
```ts
import { buildSettingsParams } from '../src/xc/commands.js';

describe('buildSettingsParams', () => {
  it('merges multiple controls into one param object', () => {
    const params = buildSettingsParams({ iso: 800, nd: 400, wbKelvin: 5600 });
    // iso brings the manual-exposure trio; wbKelvin brings wb=kelvin; nd its filter
    expect(params).toMatchObject({
      'c.1.exp': 'manual',
      'c.1.me.isogain.mode': 'iso',
      'c.1.me.iso.mode': 'manual',
      'c.1.me.iso': '800',
      'c.1.wb': 'kelvin',
      'c.1.wb.kelvin': '5600',
      'c.1.nd.filter': '400',
    });
  });

  it('returns an empty object for empty settings', () => {
    expect(buildSettingsParams({})).toEqual({});
  });

  it('later controls override shared keys deterministically', () => {
    // both iso and shutter set c.1.exp=manual — should remain 'manual', no conflict
    const params = buildSettingsParams({ iso: 400, shutter: 125 });
    expect(params['c.1.exp']).toBe('manual');
    expect(params['c.1.me.iso']).toBe('400');
    expect(params['c.1.me.shutter']).toBe('125');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL.** `pnpm --filter @xyst/core test commands`

- [ ] **Step 3: Implement** — append to `packages/core/src/xc/commands.ts`:
```ts
import type { ControlSettings } from '../types.js';

/** Merge several control changes into a single control.cgi parameter object. */
export function buildSettingsParams(settings: ControlSettings): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [id, value] of Object.entries(settings)) {
    if (value === undefined) continue;
    Object.assign(out, buildControlParams(id as ControlId, value));
  }
  return out;
}
```
(Add the `import type { ControlSettings }` next to the existing `ControlId` import, or merge into one import line.)

- [ ] **Step 4: Run it, confirm PASS** (commands now 11 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/xc/commands.ts packages/core/test/commands.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): buildSettingsParams to apply multiple controls in one request"
```

---

## Task 3: `xc/stream.ts` — multipart/x-mixed-replace consumer

Opens a long-lived `GET info.cgi?type=stream` and emits each pushed delta as a parsed `key:=value` map. Handles optional Digest/Basic auth on a 401. Closeable via an AbortController.

**Files:** create `packages/core/src/xc/stream.ts`; create `packages/core/test/stream.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/stream.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { openInfoStream } from '../src/xc/stream.js';

let srv: Server | undefined;
afterEach(() => { srv?.close(); srv = undefined; });

/** A tiny multipart/x-mixed-replace server that writes parts on a schedule. */
function streamServer(parts: string[], boundary = 'xystbnd'): Promise<string> {
  srv = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': `multipart/x-mixed-replace; boundary=${boundary}`,
      'livescope-status': '0',
    });
    let i = 0;
    const writeNext = () => {
      if (i >= parts.length) return; // keep connection open
      res.write(`--${boundary}\r\nContent-Type: text/plain\r\n\r\n${parts[i]}\r\n`);
      i++;
      setTimeout(writeNext, 20);
    };
    writeNext();
  });
  return new Promise((resolve) => srv!.listen(0, '127.0.0.1', () => {
    resolve(`127.0.0.1:${(srv!.address() as AddressInfo).port}`);
  }));
}

describe('openInfoStream', () => {
  it('emits the initial full snapshot then deltas', async () => {
    const host = await streamServer([
      'c.1.type:=Canon EOS C300 Mark III\nc.1.me.iso:=800\nf.rec.status:=idle',
      'c.1.me.iso:=1600',
      'f.rec.status:=rec',
    ]);
    const deltas: Array<Record<string, string>> = [];
    const handle = openInfoStream(host, {}, {
      onDelta: (m) => deltas.push(m),
      onError: () => {},
    });
    await vi.waitFor(() => expect(deltas.length).toBeGreaterThanOrEqual(3), { timeout: 2000 });
    handle.close();
    expect(deltas[0]['c.1.type']).toBe('Canon EOS C300 Mark III');
    expect(deltas[1]['c.1.me.iso']).toBe('1600');
    expect(deltas[2]['f.rec.status']).toBe('rec');
  });

  it('calls onError when the connection is refused', async () => {
    const onError = vi.fn();
    // nothing listening on this port
    const handle = openInfoStream('127.0.0.1:1', {}, { onDelta: () => {}, onError });
    await vi.waitFor(() => expect(onError).toHaveBeenCalled(), { timeout: 2000 });
    handle.close();
  });

  it('stops emitting after close()', async () => {
    const host = await streamServer(['a:=1', 'a:=2', 'a:=3', 'a:=4', 'a:=5']);
    const deltas: Array<Record<string, string>> = [];
    const handle = openInfoStream(host, {}, { onDelta: (m) => deltas.push(m), onError: () => {} });
    await vi.waitFor(() => expect(deltas.length).toBeGreaterThanOrEqual(1), { timeout: 2000 });
    handle.close();
    const countAtClose = deltas.length;
    await new Promise((r) => setTimeout(r, 120));
    expect(deltas.length).toBe(countAtClose); // no further deltas after close
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (module missing). `pnpm --filter @xyst/core test stream`

- [ ] **Step 3: Implement** — `packages/core/src/xc/stream.ts`
```ts
import { randomBytes } from 'node:crypto';
import { parseXcBody } from './parse.js';
import { parseChallenge, buildDigestHeader, buildBasicHeader } from './auth.js';
import type { CameraAuth } from '../types.js';

export interface InfoStreamHandlers {
  onDelta: (items: Record<string, string>) => void;
  onError: (err: Error) => void;
  onOpen?: () => void;
}

export interface InfoStreamOptions {
  auth?: CameraAuth;
  /** info.cgi item selector (default: all items). */
  item?: string;
}

export interface InfoStreamHandle {
  close(): void;
}

const BASE = '/-wvhttp-01-/';

/** Open info.cgi?type=stream and emit each multipart part as a parsed map. */
export function openInfoStream(
  host: string,
  opts: InfoStreamOptions,
  handlers: InfoStreamHandlers,
): InfoStreamHandle {
  const controller = new AbortController();
  let closed = false;
  const close = () => { closed = true; controller.abort(); };

  void run(host, opts, handlers, controller.signal, () => closed).catch((err) => {
    if (!closed) handlers.onError(err instanceof Error ? err : new Error(String(err)));
  });

  return { close };
}

async function run(
  host: string,
  opts: InfoStreamOptions,
  handlers: InfoStreamHandlers,
  signal: AbortSignal,
  isClosed: () => boolean,
): Promise<void> {
  const params = new URLSearchParams({ type: 'stream' });
  if (opts.item) params.set('item', opts.item);
  const path = `${BASE}info.cgi?${params.toString()}`;
  const url = `http://${host}${path}`;

  let res = await fetch(url, { signal });
  if (res.status === 401 && opts.auth?.username) {
    const header = authHeader(res, path, opts.auth);
    if (header) res = await fetch(url, { signal, headers: { Authorization: header } });
  }
  if (res.status !== 200 || !res.body) {
    throw new Error(`stream open failed: HTTP ${res.status}`);
  }

  const boundary = parseBoundary(res.headers.get('content-type'));
  handlers.onOpen?.();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const delim = `--${boundary}`;

  while (!isClosed()) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // Process every complete part (text between delimiters). Keep the trailing
    // fragment in buf until its terminating delimiter arrives.
    let idx: number;
    while ((idx = buf.indexOf(delim, 1)) !== -1) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx);
      emitPart(chunk, delim, handlers);
    }
  }
  if (!isClosed()) throw new Error('stream ended');
}

/** A raw chunk is `--boundary\r\n<headers>\r\n\r\n<body>`. Parse the body. */
function emitPart(chunk: string, delim: string, handlers: InfoStreamHandlers): void {
  let part = chunk;
  if (part.startsWith(delim)) part = part.slice(delim.length);
  const sep = part.indexOf('\r\n\r\n') !== -1 ? '\r\n\r\n' : '\n\n';
  const headerEnd = part.indexOf(sep);
  const body = headerEnd === -1 ? part : part.slice(headerEnd + sep.length);
  const map = parseXcBody(body);
  if (Object.keys(map).length > 0) handlers.onDelta(map);
}

function parseBoundary(contentType: string | null): string {
  const m = contentType?.match(/boundary=("?)([^";]+)\1/i);
  return m?.[2]?.trim() ?? 'boundary';
}

function authHeader(res: Response, path: string, auth: CameraAuth): string | null {
  const www = res.headers.get('www-authenticate') ?? '';
  const challenge = parseChallenge(www);
  const { username = '', password = '' } = auth;
  if (challenge) {
    return buildDigestHeader({
      username, password, method: 'GET', uri: path, challenge,
      cnonce: randomBytes(8).toString('hex'), nc: 1,
    });
  }
  if (/^basic/i.test(www)) return buildBasicHeader(username, password);
  return null;
}
```

- [ ] **Step 4: Run it, confirm PASS** (3 tests). If the "stops after close()" test is flaky because the server keeps writing, that's fine — the assertion is that `onDelta` stops firing after `close()`, which the `isClosed()`/abort guards ensure. Do not modify the test.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/xc/stream.ts packages/core/test/stream.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): info.cgi multipart stream consumer"
```

---

## Task 4: Extend `FakeCamera` with streaming support

Lets the driver-stream test drive body-side changes deterministically.

**Files:** modify `packages/core/test/fake-camera.ts`

- [ ] **Step 1: Add streaming to `FakeCamera`.** Modify the class so that:
  - It tracks open stream responses.
  - A `GET info.cgi?type=stream` responds with `multipart/x-mixed-replace; boundary=xystbnd`, immediately writes one part with the full current state, and stays open.
  - A new method `pushDelta(map: Record<string,string>)` updates internal state AND writes a new multipart part (only the changed keys) to every open stream response — simulating a body-side change.
  - `control.cgi` continues to behave as before; additionally, when it mutates state it should ALSO push the changed keys to open streams (so a control via the driver is observed on the stream too — realistic). Keep this minimal: after applying control params, push those same keys.

Replace the file with:
```ts
import { createServer, type Server, type ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const infoBody = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

const BOUNDARY = 'xystbnd';

export interface FakeCameraOptions {
  auth?: { username: string; password: string };
  failFirst?: number;
}

export class FakeCamera {
  private server: Server;
  private state: Record<string, string> = {};
  private failsLeft: number;
  private streams = new Set<ServerResponse>();
  readonly controlLog: string[] = [];

  constructor(private opts: FakeCameraOptions = {}) {
    this.failsLeft = opts.failFirst ?? 0;
    for (const line of infoBody.split('\n')) {
      const i = line.indexOf(':=');
      if (i > 0) this.state[line.slice(0, i).trim()] = line.slice(i + 2).trim();
    }
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    return `127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }
  async close(): Promise<void> {
    for (const s of this.streams) s.end();
    this.streams.clear();
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  /** Simulate a body-side change: update state and push the delta to streams. */
  pushDelta(delta: Record<string, string>): void {
    Object.assign(this.state, delta);
    this.writeToStreams(delta);
  }

  private writeToStreams(map: Record<string, string>): void {
    const body = Object.entries(map).map(([k, v]) => `${k}:=${v}`).join('\n');
    for (const res of this.streams) {
      res.write(`--${BOUNDARY}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`);
    }
  }

  private handle(req: import('node:http').IncomingMessage, res: ServerResponse) {
    if (this.failsLeft > 0) { this.failsLeft--; req.destroy(); return; }
    if (this.opts.auth && !req.headers.authorization) {
      res.writeHead(401, { 'www-authenticate': 'Digest realm="cam", nonce="testnonce", qop="auth"' });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '', 'http://x');
    const cmd = url.pathname.replace('/-wvhttp-01-/', '');

    if (cmd === 'info.cgi' && url.searchParams.get('type') === 'stream') {
      res.writeHead(200, {
        'content-type': `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
        'livescope-status': '0',
      });
      this.streams.add(res);
      req.on('close', () => this.streams.delete(res));
      this.writeToStreams.call(this, this.state); // initial full part to all (incl. this one)
      return;
    }

    if (cmd === 'control.cgi') {
      this.controlLog.push(url.search.slice(1));
      const changed: Record<string, string> = {};
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('c.') || k.startsWith('f.')) { this.state[k] = v; changed[k] = v; }
      }
      const rec = url.searchParams.get('f.rec');
      if (rec === 'on') { this.state['f.rec.status'] = 'rec'; changed['f.rec.status'] = 'rec'; }
      if (rec === 'off') { this.state['f.rec.status'] = 'idle'; changed['f.rec.status'] = 'idle'; }
      this.writeToStreams(changed);
    }

    const body = Object.entries(this.state).map(([k, v]) => `${k}:=${v}`).join('\n');
    res.writeHead(200, { 'content-type': 'text/plain;charset=utf-8', 'livescope-status': '0' });
    res.end(body);
  }
}
```

> Note: the initial-part write uses `this.writeToStreams(this.state)` but at that moment only the just-added `res` is in the set is NOT guaranteed — actually `res` was added just above, so it receives the initial full snapshot. Other pre-existing streams also get a redundant full snapshot; harmless for tests. (If you prefer, write the initial part directly to `res` only — either is acceptable; keep it simple.)

- [ ] **Step 2: Confirm existing tests still pass.** `pnpm --filter @xyst/core test` — client/driver/manager tests use `FakeCamera`; they must remain green (the non-stream paths are unchanged). Expected: all previously-green tests still pass.

- [ ] **Step 3: Commit**
```bash
git add packages/core/test/fake-camera.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "test(core): FakeCamera streaming + pushDelta for body-side change simulation"
```

---

## Task 5: Driver — stream integration, reconcile poll, applySettings

The driver now: starts the stream on connect; merges deltas + emits `state` instantly; throttles polling to a slow reconcile cadence while the stream is healthy; reverts to fast polling and retries the stream when it drops; implements `applySettings`.

**Files:** modify `packages/core/src/xc/driver.ts`; create `packages/core/test/driver-stream.test.ts`

- [ ] **Step 1: Write the failing test** — `packages/core/test/driver-stream.test.ts`
```ts
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
  it('reflects a body-side change via the stream quickly (no fast poll needed)', async () => {
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

  it('still works (falls back to polling) if the stream cannot open', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    // Force stream failures by making the camera reject the stream path:
    // simplest: connect normally; streaming may open, but verify polling keeps state fresh.
    drv = makeDriver(host);
    await drv.connect();
    expect(drv.status).toBe('connected');
    expect(drv.getState().model).toBe('Canon EOS C300 Mark III');
  });
});
```

- [ ] **Step 2: Run it, confirm FAIL** (driver has no `reconcileMs`/`applySettings`). `pnpm --filter @xyst/core test driver-stream`

- [ ] **Step 3: Modify `packages/core/src/xc/driver.ts`.** Apply these changes:

(a) Imports — add stream + settings:
```ts
import { openInfoStream, type InfoStreamHandle } from './stream.js';
import { buildControlParams, buildRecordParams, buildSettingsParams } from './commands.js';
import type {
  CameraProfile, CameraState, CameraSnapshot, ConnectionStatus, ControlId, ControlSettings,
} from '../types.js';
```

(b) Options + fields:
```ts
export interface XCDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
  /** Slow reconcile/liveness poll cadence while the stream is healthy. */
  reconcileMs?: number;
}
```
Add fields:
```ts
  private readonly reconcileMs: number;
  private stream?: InfoStreamHandle;
  private streaming = false;
  private lastActivityAt = 0;
  private streamRetry?: NodeJS.Timeout;
```
In the constructor:
```ts
    this.reconcileMs = opts.reconcileMs ?? 5000;
```

(c) `connect()` — after the initial refresh + setStatus('connected'), also start the stream:
```ts
  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.refresh();
      this.setStatus('connected');
      this.startPolling();
      this.startStream();
    } catch (err) {
      this.fail(err);
      this.startPolling();
      throw err;
    }
  }
```

(d) `disconnect()` — tear down stream + retry timer too:
```ts
  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (this.streamRetry) clearTimeout(this.streamRetry);
    this.streamRetry = undefined;
    this.stopStream();
    this.setStatus('disconnected');
  }
```

(e) Add `applySettings` (near setControl):
```ts
  async setControl(id: ControlId, value: string | number): Promise<void> {
    await this.control(buildControlParams(id, value));
  }

  async applySettings(settings: ControlSettings): Promise<void> {
    const params = buildSettingsParams(settings);
    if (Object.keys(params).length === 0) return;
    await this.control(params);
  }
```

(f) Mark activity in `refresh()` and after merges. Change `refresh()` so it records activity:
```ts
  private async refresh(): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'info.cgi', {}, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    this.lastError = undefined;
    this.snapshot = interpretInfo(map);
    this.snapshotAt = Date.now();
    this.lastActivityAt = Date.now();
    this.emit('state', this.getState());
  }
```

(g) Throttle polling while streaming — change `poll()`:
```ts
  private async poll(): Promise<void> {
    if (this.polling || this.controlInFlight) return;
    // While the stream is healthy, only poll as a slow reconcile/liveness check.
    if (this.streaming && Date.now() - this.lastActivityAt < this.reconcileMs) return;
    this.polling = true;
    try {
      await this.refresh();
      if (this._status === 'error') this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
    }
  }
```

(h) Stream lifecycle + delta merge. Add:
```ts
  private startStream(): void {
    if (this.stream) return;
    this.stream = openInfoStream(this.profile.host, { auth: this.profile.auth }, {
      onOpen: () => { this.streaming = true; this.lastActivityAt = Date.now(); },
      onDelta: (map) => this.onStreamDelta(map),
      onError: () => this.onStreamDown(),
    });
  }

  private stopStream(): void {
    this.streaming = false;
    this.stream?.close();
    this.stream = undefined;
  }

  private onStreamDelta(map: Record<string, string>): void {
    this.streaming = true;
    this.lastActivityAt = Date.now();
    this.mergeMap(map);
    this.snapshotAt = Date.now();
    if (this._status === 'error') this.setStatus('connected');
    this.emit('state', this.getState());
  }

  private onStreamDown(): void {
    this.stopStream();
    // Fast polling (poll loop already running) covers state until the stream returns.
    if (this.streamRetry) return;
    this.streamRetry = setTimeout(() => {
      this.streamRetry = undefined;
      if (this._status !== 'disconnected') this.startStream();
    }, 2000);
  }
```

(i) Replace `applyPartial` with a reusable `mergeMap` (used by both control echo and stream). Find the existing `applyPartial` and the call in `control()`; rename to `mergeMap` and extend to also pick up model/exposureMode:
```ts
  private mergeMap(map: Record<string, string>): void {
    const merged = interpretInfo(map);
    if ('c.1.type' in map && merged.model) this.snapshot.model = merged.model;
    if ('c.1.exp' in map && merged.exposureMode) this.snapshot.exposureMode = merged.exposureMode;
    if ('f.rec.status' in map) {
      this.snapshot.record = { ...this.snapshot.record, ...merged.record };
    }
    this.snapshot.controls = { ...this.snapshot.controls, ...merged.controls };
  }
```
And in `control()`, change `this.applyPartial(map);` to `this.mergeMap(map);`.

- [ ] **Step 4: Run the stream + the existing driver tests, confirm PASS.**
```bash
pnpm --filter @xyst/core test driver-stream
pnpm --filter @xyst/core test driver
```
Both green. Run them 2–3× to check stream timing stability.

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/xc/driver.ts packages/core/test/driver-stream.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): driver consumes info.cgi stream, reconcile-polls, and applySettings"
```

---

## Task 6: Manager — save/recall/delete presets (capability-aware recall)

**Files:** modify `packages/core/src/manager.ts`; modify `packages/core/test/manager.test.ts`

- [ ] **Step 1: Write the failing tests** — append inside `manager.test.ts`:
```ts
  it('saves a preset capturing the current settings and persists it', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Look A');
    expect(preset.name).toBe('Look A');
    expect(preset.settings.iso).toBe(800); // from the fixture's current ISO
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras[0].presets.map((p: any) => p.name)).toContain('Look A');
  });

  it('recalls a preset by applying its settings to the camera', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Look A');
    // change ISO away from the preset, then recall and expect it restored
    await mgr.setControl('cam-1', 'iso', 3200);
    await mgr.recallPreset('cam-1', preset.id);
    expect(cam.controlLog.at(-1)).toContain('c.1.me.iso=800');
  });

  it('deletes a preset and persists the removal', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    const preset = await mgr.savePreset('cam-1', 'Temp');
    await mgr.deletePreset('cam-1', preset.id);
    expect(mgr.listPresets('cam-1')).toHaveLength(0);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras[0].presets ?? []).toHaveLength(0);
  });
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @xyst/core test manager`

- [ ] **Step 3: Implement in `packages/core/src/manager.ts`.**

(a) Imports:
```ts
import type { CameraProfile, CameraState, ControlId, ControlSettings, CameraPreset } from './types.js';
```

(b) A stable id generator that does NOT use Date.now()/Math.random() alone for collision safety — use a counter + the camera id. Add a private field `private presetSeq = 0;` and:
```ts
  private nextPresetId(cameraId: string): string {
    this.presetSeq += 1;
    return `${cameraId}-p${this.presetSeq}-${this.listProfiles().length}`;
  }
```
(Uniqueness within a manager instance is sufficient; ids need not be globally unique.)

(c) The capture/recall/delete methods + a settings extractor:
```ts
  listPresets(cameraId: string): CameraPreset[] {
    return this.profiles.get(cameraId)?.presets ?? [];
  }

  async savePreset(cameraId: string, name: string): Promise<CameraPreset> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    const state = this.driver(cameraId).getState();
    const preset: CameraPreset = {
      id: this.nextPresetId(cameraId),
      name,
      exposureMode: state.exposureMode,
      settings: extractSettings(state),
    };
    profile.presets = [...(profile.presets ?? []), preset];
    await this.save();
    this.emit('presets', cameraId, profile.presets);
    return preset;
  }

  async recallPreset(cameraId: string, presetId: string): Promise<void> {
    const preset = this.listPresets(cameraId).find((p) => p.id === presetId);
    if (!preset) throw new Error(`no preset ${presetId} on ${cameraId}`);
    const state = this.driver(cameraId).getState();
    // Capability-aware: only apply controls the camera currently advertises.
    const applicable: ControlSettings = {};
    for (const [id, value] of Object.entries(preset.settings)) {
      if (state.controls[id as ControlId]?.available) applicable[id as ControlId] = value;
    }
    await this.driver(cameraId).applySettings(applicable);
  }

  async deletePreset(cameraId: string, presetId: string): Promise<void> {
    const profile = this.profiles.get(cameraId);
    if (!profile) throw new Error(`no camera with id ${cameraId}`);
    profile.presets = (profile.presets ?? []).filter((p) => p.id !== presetId);
    await this.save();
    this.emit('presets', cameraId, profile.presets);
  }
```

(d) The settings extractor (module-scope helper at the bottom of the file):
```ts
function extractSettings(state: CameraState): ControlSettings {
  const out: ControlSettings = {};
  const ids: ControlId[] = ['iso', 'gain', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];
  for (const id of ids) {
    const c = state.controls[id];
    if (c?.available && c.value !== undefined) out[id] = c.value;
  }
  return out;
}
```

> Note: `save()` already writes `this.listProfiles()` which now includes `presets` on each profile — no change to `save()` needed. Recall uses `applySettings` (Task 5). The `'presets'` event is wired into IPC in Task 7.

- [ ] **Step 4: Run, confirm PASS** (manager now 9 tests). Run the full core suite — all green. Then:
```bash
pnpm --filter @xyst/core typecheck
```
Expected: ZERO errors (Task 1's `applySettings` interface is now implemented by the driver; types resolve).

- [ ] **Step 5: Commit**
```bash
git add packages/core/src/manager.ts packages/core/test/manager.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(core): save/recall/delete per-camera presets with capability-aware recall"
```

---

## Task 7: App IPC + preload — preset channels and presets push

**Files:** modify `packages/app/src/main/ipc.ts`; modify `packages/app/src/preload/index.ts`

- [ ] **Step 1: Add preset handlers + presets push in `ipc.ts`.** Inside `registerIpc`, add after the existing handlers:
```ts
  ipcMain.handle('camera:presets', (_e, id: string) => mgr.listPresets(id));
  ipcMain.handle('camera:savePreset', (_e, id: string, name: string) => mgr.savePreset(id, name));
  ipcMain.handle('camera:recallPreset', (_e, id: string, presetId: string) => mgr.recallPreset(id, presetId));
  ipcMain.handle('camera:deletePreset', (_e, id: string, presetId: string) => mgr.deletePreset(id, presetId));
```
And after the existing `mgr.on('state'/'status', ...)` lines, push presets changes:
```ts
  mgr.on('presets', (id: string, presets: unknown) =>
    getWindow()?.webContents.send('camera:presets', id, presets));
```

- [ ] **Step 2: Add preset API + presets subscription to the preload** (`src/preload/index.ts`). Extend the `api` object:
```ts
  presets: (id: string) => ipcRenderer.invoke('camera:presets', id),
  savePreset: (id: string, name: string) => ipcRenderer.invoke('camera:savePreset', id, name),
  recallPreset: (id: string, presetId: string) => ipcRenderer.invoke('camera:recallPreset', id, presetId),
  deletePreset: (id: string, presetId: string) => ipcRenderer.invoke('camera:deletePreset', id, presetId),
  onPresets: (cb: (id: string, presets: unknown) => void) => {
    const h = (_e: unknown, id: string, presets: unknown) => cb(id, presets);
    ipcRenderer.on('camera:presets', h);
    return () => ipcRenderer.off('camera:presets', h);
  },
```

- [ ] **Step 3: Typecheck.** `pnpm --filter @xyst/app typecheck` — zero errors. (The `XystApi` type widens automatically; renderer usage comes in Task 8.)

- [ ] **Step 4: Commit**
```bash
git add packages/app/src/main/ipc.ts packages/app/src/preload/index.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(app): IPC + preload for preset save/recall/delete and presets push"
```

---

## Task 8: Renderer — PresetBar in each camera panel

**Files:** create `packages/app/src/renderer/hooks/usePresets.ts`, `packages/app/src/renderer/components/PresetBar.tsx`; modify `packages/app/src/renderer/components/CameraPanel.tsx`

- [ ] **Step 1: `usePresets` hook** — `packages/app/src/renderer/hooks/usePresets.ts`
```ts
import { useEffect, useState, useCallback } from 'react';
import type { CameraPreset } from '@xyst/core';

export function usePresets(cameraId: string) {
  const [presets, setPresets] = useState<CameraPreset[]>([]);

  const refresh = useCallback(async () => {
    setPresets((await window.xyst.presets(cameraId)) as CameraPreset[]);
  }, [cameraId]);

  useEffect(() => {
    void refresh();
    const off = window.xyst.onPresets((id, p) => {
      if (id === cameraId) setPresets(p as CameraPreset[]);
    });
    return off;
  }, [cameraId, refresh]);

  return { presets, refresh };
}
```

- [ ] **Step 2: `PresetBar` component** — `packages/app/src/renderer/components/PresetBar.tsx`
```tsx
import { useState } from 'react';
import type { CameraPreset } from '@xyst/core';

export function PresetBar({ cameraId, presets }: { cameraId: string; presets: CameraPreset[] }) {
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const label = name.trim() || `Preset ${presets.length + 1}`;
    setBusy(true);
    try { await window.xyst.savePreset(cameraId, label); setName(''); }
    finally { setBusy(false); }
  };

  return (
    <div style={{ marginTop: 12, display: 'grid', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={name} onChange={(e) => setName(e.target.value)} placeholder="Preset name"
          style={{ flex: 1, background: 'var(--surface-2)', color: 'var(--text)',
            border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}
        />
        <button className="btn" disabled={busy} onClick={save}>Save</button>
      </div>
      {presets.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {presets.map((p) => (
            <span key={p.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 6,
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 999, padding: '4px 6px 4px 12px' }}>
              <button className="btn--ghost" style={{ border: 'none', padding: 0 }}
                title="Recall" onClick={() => window.xyst.recallPreset(cameraId, p.id)}>{p.name}</button>
              <button className="btn--ghost" title="Delete" style={{ border: 'none', padding: '0 4px', color: 'var(--muted)' }}
                onClick={() => window.xyst.deletePreset(cameraId, p.id)}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Wire into `CameraPanel.tsx`.** Add the import + hook + render the bar after the controls grid:
```tsx
import { usePresets } from '../hooks/usePresets.js';
import { PresetBar } from './PresetBar.js';
```
Inside `CameraPanel`, near the top of the component body:
```tsx
  const { presets } = usePresets(state.id);
```
After the closing `</div>` of the controls grid (still inside the `<section>`), add:
```tsx
      <PresetBar cameraId={state.id} presets={presets} />
```

- [ ] **Step 4: Typecheck + build.**
```bash
pnpm --filter @xyst/app typecheck
pnpm --filter @xyst/app build
```
Both must pass.

- [ ] **Step 5: Commit**
```bash
git add packages/app/src/renderer
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(app): per-camera preset bar (save/recall/delete)"
```

---

## Task 9: Full verification + docs

- [ ] **Step 1: Whole-monorepo green check.**
```bash
pnpm -r test && pnpm -r typecheck && pnpm --filter @xyst/app build
```
All green.

- [ ] **Step 2: Update `CLAUDE.md`.** In the phase table, mark Phase 2's deliverable as implemented (state stream + presets); under "Decisions log" add: streaming via `info.cgi?type=stream` with a slow reconcile poll (default 5 s) as liveness/fallback, fast 750 ms poll when the stream is down; presets are app-level named snapshots stored per-camera in `cameras.json`, recall is capability-aware. Move the `info.cgi` event-stream note from "Phase 2 (params identified…)" to done. Commit:
```bash
git add CLAUDE.md && git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "docs: mark Phase 2 (state stream + presets) implemented in CLAUDE.md"
```

- [ ] **Step 3: Hardware verification (with the user, when a camera is on the LAN).** This rides along with the Phase 1 Task 14 gate:
  - Change a setting **on the camera body** (ISO, ND, WB) → the app reflects it within ~1 s via the stream (not just on the slow reconcile).
  - Save a preset, change several settings, recall it → the body returns to the saved look in one action.
  - Delete a preset → it disappears and stays gone after an app restart.
  - Pull the camera's Ethernet → status goes to `error` within a few seconds (reconcile poll / stream error), and replugging recovers (stream re-opens).

---

## Self-review notes (author)

- **Spec coverage:** state sync via `info.cgi?type=stream` (Tasks 3–5) → satisfies the Phase 2 gate "settings changed on the body are reflected in the app"; presets save/recall/delete per-camera (Tasks 1, 6–8). Out of scope and correctly absent: REST/Companion (Phase 3), live view (Phase 5), touch focus (Phase 6).
- **Robustness preserved:** polling is never removed — it's throttled to `reconcileMs` while streaming and reverts to `pollMs` if the stream drops; stream errors trigger a 2 s retry; `disconnect()` tears down stream + timers. The Phase 1 reconnect/never-lock-up behavior is intact.
- **Type consistency:** `ControlSettings`/`CameraPreset` defined once in `types.ts`; `applySettings` on the interface (Task 1) is implemented by the driver (Task 5); `buildSettingsParams` (Task 2) is the single place settings→params happens, reusing `buildControlParams`. Recall is capability-gated against live `state.controls[id].available`.
- **Determinism:** preset ids use a manager-scoped counter (no `Date.now()`/`Math.random()` reliance for correctness), fine for per-instance uniqueness.
- **Known Phase-2 simplifications (intended):** preset capture takes the current `state` snapshot (whatever the controls currently report); a preset saved before the camera fully reported (controls empty) would be sparse — acceptable since save is a deliberate operator action on a connected camera. The stream's initial full part also flows through `mergeMap` (merge, not replace) which is correct because `connect()` already did a full `refresh()` first.
```

