# XYST CONTROL — Phase 7 (native Bitfocus Companion module) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** A proper Bitfocus Companion module (`@companion-module/base`, TypeScript) in a separate package that drives XYST CONTROL via its local REST/SSE API — actions for every camera control, feedbacks for REC/tally (button red while recording), and variables for current ISO/shutter/iris/WB/ND per camera. The module is a thin client of the app's API (the single source of truth), so there is **no duplicated camera logic**.

**Architecture:** New workspace package `packages/companion-module`. It talks ONLY to the app's REST API (`http://<host>:<port>/api/...`) and subscribes to `GET /api/events` (SSE) for live state. The testable core — REST client, SSE parser, and state→variables/feedbacks derivation — are plain TS modules with Vitest tests. The Companion glue (`InstanceBase` subclass + action/feedback/variable wiring) is thin and typecheck-gated. Shared response shapes are imported **type-only** from `@xyst/core` (zero runtime coupling).

**Tech Stack:** TypeScript, `@companion-module/base` (runtime), `@companion-module/tools` (build), Vitest. Node 22 runtime (Companion's module host). No hardware needed — tested against a fake API server / the sim.

**Spec source:** kickoff §3 Stage 2.

---

## Conventions
- TDD for the logic modules (C2–C4). Glue (C5) is typecheck- + build-gated. Commit per task. `git -c user.name='XYST' -c user.email='zak@xyst.la' commit`.
- Tests: `pnpm --filter @xyst/companion-module test`. Typecheck: `pnpm --filter @xyst/companion-module typecheck`.
- Branch: continue on `phase-1`.

---

## File structure (new package)

```
packages/companion-module/
  package.json            # @xyst/companion-module; deps @companion-module/base; dev @companion-module/tools, vitest, typescript
  tsconfig.json
  vitest.config.ts
  companion/manifest.json # Companion 3.x+ manifest
  src/
    index.ts              # runEntrypoint(ModuleInstance); thin glue
    config.ts             # XystConfig + getConfigFields
    api.ts                # XystApiClient (REST) — pure fetch wrapper
    sse.ts                # parseSseChunk + subscribeEvents
    state.ts              # CameraStore: variables + feedback derivation, choices
    actions.ts            # buildActions(store, api)
    feedbacks.ts          # buildFeedbacks(store)
    variables.ts          # variableDefinitions(store) (re-exported from state)
  test/
    api.test.ts  state.test.ts  sse.test.ts
```

---

## Task C1: Package scaffold

**Files:** `packages/companion-module/{package.json,tsconfig.json,vitest.config.ts,companion/manifest.json}`

- [ ] **Step 1: `package.json`**
```json
{
  "name": "@xyst/companion-module",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "scripts": {
    "build": "companion-module-build",
    "dev": "companion-module-build --dev",
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@companion-module/base": "~1.11.0"
  },
  "devDependencies": {
    "@companion-module/tools": "~2.1.0",
    "typescript": "^5.5.4",
    "vitest": "^2.0.5"
  }
}
```

- [ ] **Step 2: `tsconfig.json`**
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "types": ["node"] },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: `vitest.config.ts`**
```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'] } });
```

- [ ] **Step 4: `companion/manifest.json`**
```json
{
  "id": "xyst-control",
  "name": "xyst-control",
  "shortname": "XYST",
  "description": "Control XYST CONTROL (Canon cinema cameras) — record, exposure, presets",
  "manufacturer": "XYST",
  "products": ["XYST CONTROL"],
  "keywords": ["camera", "canon", "cinema", "record"],
  "version": "0.0.0",
  "license": "MIT",
  "repository": "git+https://github.com/xyst/xyst-control.git",
  "bugs": "https://github.com/xyst/xyst-control/issues",
  "maintainers": [{ "name": "XYST", "email": "zak@xyst.la" }],
  "legacyIds": [],
  "runtime": {
    "type": "node22",
    "api": "nodejs-ipc",
    "apiVersion": "0.0.0",
    "entrypoint": "../dist/index.js"
  }
}
```

- [ ] **Step 5: Install + sanity**
```bash
pnpm install
```
Expect `@companion-module/base` + tools resolved. (If the registry is slow, retry.) Do NOT build yet (no source).

- [ ] **Step 6: Commit**
```bash
git add packages/companion-module/package.json packages/companion-module/tsconfig.json packages/companion-module/vitest.config.ts packages/companion-module/companion pnpm-lock.yaml
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "chore(companion): scaffold Bitfocus Companion module package"
```

---

## Task C2: REST API client (TDD)

A thin typed wrapper over the app's REST routes. Tested against a tiny fake HTTP server.

**Files:** `packages/companion-module/src/api.ts`, `packages/companion-module/test/api.test.ts`

- [ ] **Step 1: Failing test** — `test/api.test.ts`
```ts
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
```

- [ ] **Step 2: Run, confirm FAIL.** `pnpm --filter @xyst/companion-module test api`

- [ ] **Step 3: Implement** — `src/api.ts`
```ts
import type { CameraState, ControlId } from '@xyst/core';

export class XystApiClient {
  constructor(private base: string) {}

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`API ${method} ${path} -> ${res.status}`);
    const text = await res.text();
    return text ? JSON.parse(text) : undefined;
  }

  getCameras(): Promise<CameraState[]> { return this.req('GET', '/api/cameras') as Promise<CameraState[]>; }
  recordStart(id: string): Promise<unknown> { return this.req('POST', `/api/cameras/${id}/record/start`); }
  recordStop(id: string): Promise<unknown> { return this.req('POST', `/api/cameras/${id}/record/stop`); }
  recordAll(start: boolean): Promise<unknown> { return this.req('POST', `/api/record/${start ? 'start' : 'stop'}`); }
  setControl(id: string, control: ControlId, value: string | number): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/controls/${control}`, { value });
  }
  savePreset(id: string, name: string): Promise<unknown> {
    return this.req('POST', `/api/cameras/${id}/presets`, { name });
  }
  recallPreset(presetId: string): Promise<unknown> {
    return this.req('POST', `/api/presets/${presetId}/recall`);
  }
}
```
> `@xyst/core` is a workspace package; add it as a dependency so the type-only import resolves. In `packages/companion-module/package.json` add to `dependencies`: `"@xyst/core": "workspace:*"`. (Type-only import → no runtime coupling; the bundler tree-shakes it.) Re-run `pnpm install` after editing.

- [ ] **Step 4: Run, confirm PASS** (4 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/companion-module/src/api.ts packages/companion-module/test/api.test.ts packages/companion-module/package.json pnpm-lock.yaml
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(companion): REST API client"
```

---

## Task C3: CameraStore — variables, feedbacks, choices (TDD)

Holds the latest camera states and derives Companion variable definitions/values, the REC feedback boolean, and camera dropdown choices.

**Files:** `packages/companion-module/src/state.ts`, `packages/companion-module/test/state.test.ts`

- [ ] **Step 1: Failing test** — `test/state.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { CameraStore } from '../src/state.js';
import type { CameraState } from '@xyst/core';

const mk = (over: Partial<CameraState> = {}): CameraState => ({
  id: 'cam-1', name: 'C300', status: 'connected', updatedAt: 0,
  model: 'Canon EOS C300 Mark III',
  record: { recording: false },
  controls: {
    iso: { id: 'iso', available: true, value: 800 },
    shutter: { id: 'shutter', available: true, value: 2000 },
    wb: { id: 'wb', available: true, value: 'kelvin' },
    nd: { id: 'nd', available: true, value: 400 },
  },
  ...over,
});

describe('CameraStore', () => {
  it('derives camera choices', () => {
    const s = new CameraStore();
    s.setCameras([mk()]);
    expect(s.cameraChoices()).toEqual([{ id: 'cam-1', label: 'C300' }]);
  });

  it('derives variable definitions and values', () => {
    const s = new CameraStore();
    s.setCameras([mk()]);
    const defs = s.variableDefinitions().map((d) => d.variableId);
    expect(defs).toContain('cam_1_iso');
    expect(defs).toContain('cam_1_recording');
    const vals = s.variableValues();
    expect(vals['cam_1_iso']).toBe(800);
    expect(vals['cam_1_recording']).toBe('off');
    expect(vals['cam_1_wb']).toBe('kelvin');
  });

  it('reports recording feedback per camera', () => {
    const s = new CameraStore();
    s.setCameras([mk({ record: { recording: true } })]);
    expect(s.isRecording('cam-1')).toBe(true);
    s.applyState('cam-1', mk({ record: { recording: false } }));
    expect(s.isRecording('cam-1')).toBe(false);
    expect(s.variableValues()['cam_1_recording']).toBe('off');
  });

  it('isRecording is false for an unknown camera', () => {
    expect(new CameraStore().isRecording('nope')).toBe(false);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** — `src/state.ts`
```ts
import type { CameraState, ControlId } from '@xyst/core';

export interface VariableDef { variableId: string; name: string }
export type VariableValues = Record<string, string | number | undefined>;
export interface Choice { id: string; label: string }

const CONTROLS: ControlId[] = ['iso', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];
const vid = (cameraId: string, suffix: string): string =>
  `${cameraId.replace(/[^A-Za-z0-9]+/g, '_')}_${suffix}`;

export class CameraStore {
  private cams = new Map<string, CameraState>();

  setCameras(list: CameraState[]): void {
    this.cams = new Map(list.map((c) => [c.id, c]));
  }
  applyState(id: string, state: CameraState): void { this.cams.set(id, state); }

  list(): CameraState[] { return [...this.cams.values()]; }
  cameraChoices(): Choice[] { return this.list().map((c) => ({ id: c.id, label: c.name ?? c.id })); }
  isRecording(id: string): boolean { return this.cams.get(id)?.record.recording ?? false; }

  variableDefinitions(): VariableDef[] {
    const defs: VariableDef[] = [];
    for (const c of this.list()) {
      const label = c.name ?? c.id;
      defs.push(
        { variableId: vid(c.id, 'name'), name: `${label} name` },
        { variableId: vid(c.id, 'status'), name: `${label} status` },
        { variableId: vid(c.id, 'model'), name: `${label} model` },
        { variableId: vid(c.id, 'recording'), name: `${label} recording` },
      );
      for (const ctl of CONTROLS) defs.push({ variableId: vid(c.id, ctl), name: `${label} ${ctl}` });
    }
    return defs;
  }

  variableValues(): VariableValues {
    const vals: VariableValues = {};
    for (const c of this.list()) {
      vals[vid(c.id, 'name')] = c.name;
      vals[vid(c.id, 'status')] = c.status;
      vals[vid(c.id, 'model')] = c.model;
      vals[vid(c.id, 'recording')] = c.record.recording ? 'rec' : 'off';
      for (const ctl of CONTROLS) vals[vid(c.id, ctl)] = c.controls[ctl]?.value;
    }
    return vals;
  }
}
```

- [ ] **Step 4: Run, confirm PASS** (4 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/companion-module/src/state.ts packages/companion-module/test/state.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(companion): CameraStore variables/feedbacks/choices"
```

---

## Task C4: SSE parser + subscriber (TDD on the parser)

**Files:** `packages/companion-module/src/sse.ts`, `packages/companion-module/test/sse.test.ts`

- [ ] **Step 1: Failing test** — `test/sse.test.ts`
```ts
import { describe, it, expect } from 'vitest';
import { SseParser } from '../src/sse.js';

describe('SseParser', () => {
  it('parses complete events split across chunks', () => {
    const events: Array<{ event: string; data: string }> = [];
    const p = new SseParser((e, d) => events.push({ event: e, data: d }));
    p.push('event: state\ndata: {"camera');
    p.push('Id":"cam-1"}\n\n');
    p.push('event: status\ndata: {}\n\n');
    expect(events).toEqual([
      { event: 'state', data: '{"cameraId":"cam-1"}' },
      { event: 'status', data: '{}' },
    ]);
  });

  it('ignores comment/keepalive lines', () => {
    const events: Array<{ event: string; data: string }> = [];
    const p = new SseParser((e, d) => events.push({ event: e, data: d }));
    p.push(': ping\n\n');
    p.push('event: hello\ndata: {}\n\n');
    expect(events).toEqual([{ event: 'hello', data: '{}' }]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL.**

- [ ] **Step 3: Implement** — `src/sse.ts`
```ts
/** Incremental Server-Sent-Events parser. Calls back with (event, data) per block. */
export class SseParser {
  private buf = '';
  private event = 'message';
  private data: string[] = [];

  constructor(private onEvent: (event: string, data: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf('\n')) !== -1) {
      const line = this.buf.slice(0, nl).replace(/\r$/, '');
      this.buf = this.buf.slice(nl + 1);
      this.line(line);
    }
  }

  private line(line: string): void {
    if (line === '') { // dispatch
      if (this.data.length > 0) this.onEvent(this.event, this.data.join('\n'));
      this.event = 'message';
      this.data = [];
      return;
    }
    if (line.startsWith(':')) return; // comment / keepalive
    const idx = line.indexOf(':');
    const field = idx === -1 ? line : line.slice(0, idx);
    let value = idx === -1 ? '' : line.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.event = value;
    else if (field === 'data') this.data.push(value);
  }
}

export interface SseHandle { close(): void }

/** Subscribe to an SSE endpoint; reconnects on drop. */
export function subscribeEvents(
  url: string,
  onEvent: (event: string, data: string) => void,
  onError?: (err: Error) => void,
): SseHandle {
  let closed = false;
  let ctrl = new AbortController();

  const run = async (): Promise<void> => {
    while (!closed) {
      ctrl = new AbortController();
      try {
        const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream' } });
        if (!res.body) throw new Error(`SSE ${res.status}`);
        const parser = new SseParser(onEvent);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        while (!closed) {
          const { value, done } = await reader.read();
          if (done) break;
          parser.push(dec.decode(value, { stream: true }));
        }
      } catch (err) {
        if (!closed) onError?.(err instanceof Error ? err : new Error(String(err)));
      }
      if (!closed) await new Promise((r) => setTimeout(r, 2000)); // reconnect backoff
    }
  };
  void run();
  return { close: () => { closed = true; ctrl.abort(); } };
}
```

- [ ] **Step 4: Run, confirm PASS** (2 tests).

- [ ] **Step 5: Commit**
```bash
git add packages/companion-module/src/sse.ts packages/companion-module/test/sse.test.ts
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(companion): SSE parser + reconnecting subscriber"
```

---

## Task C5: Companion glue — config, actions, feedbacks, module entry

Thin wiring over the tested logic. Verified by typecheck (and build if the toolchain is available).

**Files:** `packages/companion-module/src/{config.ts,actions.ts,feedbacks.ts,index.ts}`

- [ ] **Step 1: `src/config.ts`**
```ts
import type { SomeCompanionConfigField } from '@companion-module/base';

export interface XystConfig { host: string; port: number }

export function getConfigFields(): SomeCompanionConfigField[] {
  return [
    { type: 'textinput', id: 'host', label: 'XYST app host', width: 6, default: '127.0.0.1' },
    { type: 'number', id: 'port', label: 'API port', width: 6, default: 8088, min: 1, max: 65535 },
  ];
}

export const baseUrl = (c: XystConfig): string => `http://${c.host || '127.0.0.1'}:${c.port || 8088}`;
```

- [ ] **Step 2: `src/feedbacks.ts`**
```ts
import { combineRgb, type CompanionFeedbackDefinitions } from '@companion-module/base';
import type { CameraStore } from './state.js';

export function buildFeedbacks(store: CameraStore): CompanionFeedbackDefinitions {
  return {
    recording: {
      type: 'boolean',
      name: 'Camera is recording (tally)',
      defaultStyle: { bgcolor: combineRgb(255, 0, 0), color: combineRgb(255, 255, 255) },
      options: [{
        type: 'dropdown', id: 'camera', label: 'Camera',
        default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
      }],
      callback: (fb) => store.isRecording(String(fb.options.camera ?? '')),
    },
  };
}
```

- [ ] **Step 3: `src/actions.ts`**
```ts
import type { CompanionActionDefinitions } from '@companion-module/base';
import type { ControlId } from '@xyst/core';
import type { XystApiClient } from './api.js';
import type { CameraStore } from './state.js';

const CONTROLS: ControlId[] = ['iso', 'shutter', 'iris', 'wb', 'wbKelvin', 'nd'];

export function buildActions(store: CameraStore, api: XystApiClient): CompanionActionDefinitions {
  const cameraOpt = () => ({
    type: 'dropdown' as const, id: 'camera', label: 'Camera',
    default: store.cameraChoices()[0]?.id ?? '', choices: store.cameraChoices(),
  });
  const cam = (opts: Record<string, unknown>) => String(opts.camera ?? '');

  return {
    record_start: { name: 'Record: start', options: [cameraOpt()], callback: async (e) => { await api.recordStart(cam(e.options)); } },
    record_stop: { name: 'Record: stop', options: [cameraOpt()], callback: async (e) => { await api.recordStop(cam(e.options)); } },
    record_toggle: {
      name: 'Record: toggle', options: [cameraOpt()],
      callback: async (e) => {
        const id = cam(e.options);
        await (store.isRecording(id) ? api.recordStop(id) : api.recordStart(id));
      },
    },
    record_all_start: { name: 'Record ALL: start', options: [], callback: async () => { await api.recordAll(true); } },
    record_all_stop: { name: 'Record ALL: stop', options: [], callback: async () => { await api.recordAll(false); } },
    set_control: {
      name: 'Set control (ISO/shutter/iris/WB/Kelvin/ND)',
      options: [
        cameraOpt(),
        { type: 'dropdown', id: 'control', label: 'Control', default: 'iso',
          choices: CONTROLS.map((c) => ({ id: c, label: c })) },
        { type: 'textinput', id: 'value', label: 'Value', default: '', useVariables: true },
      ],
      callback: async (e, ctx) => {
        const raw = await ctx.parseVariablesInString(String(e.options.value ?? ''));
        const n = Number(raw);
        const value = raw !== '' && Number.isFinite(n) ? n : raw;
        await api.setControl(cam(e.options), e.options.control as ControlId, value);
      },
    },
    recall_preset: {
      name: 'Recall preset (by id)',
      options: [{ type: 'textinput', id: 'presetId', label: 'Preset ID', default: '', useVariables: true }],
      callback: async (e, ctx) => { await api.recallPreset(await ctx.parseVariablesInString(String(e.options.presetId ?? ''))); },
    },
  };
}
```

- [ ] **Step 4: `src/index.ts`**
```ts
import { InstanceBase, InstanceStatus, runEntrypoint } from '@companion-module/base';
import type { CameraState } from '@xyst/core';
import { type XystConfig, getConfigFields, baseUrl } from './config.js';
import { XystApiClient } from './api.js';
import { CameraStore } from './state.js';
import { subscribeEvents, type SseHandle } from './sse.js';
import { buildActions } from './actions.js';
import { buildFeedbacks } from './feedbacks.js';

class ModuleInstance extends InstanceBase<XystConfig> {
  private store = new CameraStore();
  private api!: XystApiClient;
  private sse?: SseHandle;
  private config!: XystConfig;

  async init(config: XystConfig): Promise<void> {
    this.config = config;
    await this.start();
  }

  async configUpdated(config: XystConfig): Promise<void> {
    this.config = config;
    this.sse?.close();
    await this.start();
  }

  async destroy(): Promise<void> { this.sse?.close(); }

  getConfigFields() { return getConfigFields(); }

  private async start(): Promise<void> {
    this.updateStatus(InstanceStatus.Connecting);
    this.api = new XystApiClient(baseUrl(this.config));
    try {
      this.store.setCameras(await this.api.getCameras());
      this.updateStatus(InstanceStatus.Ok);
    } catch {
      this.updateStatus(InstanceStatus.ConnectionFailure, 'Cannot reach the XYST app API');
    }
    this.refreshDefinitions();
    this.pushVariableValues();
    this.sse = subscribeEvents(`${baseUrl(this.config)}/api/events`,
      (event, data) => this.onEvent(event, data),
      () => this.updateStatus(InstanceStatus.ConnectionFailure));
  }

  private onEvent(event: string, data: string): void {
    try {
      const payload = JSON.parse(data) as { cameraId?: string; state?: CameraState };
      if (event === 'state' && payload.cameraId && payload.state) {
        this.store.applyState(payload.cameraId, payload.state);
        this.updateStatus(InstanceStatus.Ok);
        this.pushVariableValues();
        this.checkFeedbacks('recording');
      } else if (event === 'status') {
        this.updateStatus(InstanceStatus.Ok);
      }
    } catch { /* ignore malformed */ }
  }

  private refreshDefinitions(): void {
    this.setActionDefinitions(buildActions(this.store, this.api));
    this.setFeedbackDefinitions(buildFeedbacks(this.store));
    this.setVariableDefinitions(this.store.variableDefinitions());
  }

  private pushVariableValues(): void {
    this.setVariableValues(this.store.variableValues() as Record<string, string | number | undefined>);
  }
}

runEntrypoint(ModuleInstance, []);
```

- [ ] **Step 5: Typecheck.** `pnpm --filter @xyst/companion-module typecheck` — zero errors.
  - The `@companion-module/base` types drive the action/feedback/config shapes. If a callback signature or option type mismatches the installed version, FIX to match the real types (read `node_modules/@companion-module/base` typings) — do NOT `any`-cast away. Common adjustments: `CompanionActionEvent` option access is `e.options.x` (typed `unknown`/`CompanionOptionValues`), the action callback is `(event, context)`. Keep the `String(...)`/`Number(...)` coercions.

- [ ] **Step 6: Build (best-effort).** `pnpm --filter @xyst/companion-module build`.
  - This runs `companion-module-build` (bundles `src/index.ts` → `dist/index.js`). If it succeeds, confirm `dist/index.js` exists. If the tool fails in this headless environment for reasons unrelated to our code (e.g. it needs git metadata or network), report it as DONE_WITH_CONCERNS with the exact error — typecheck passing is the hard gate; the bundle can be produced later. Do NOT hack the source to satisfy the bundler.

- [ ] **Step 7: Commit**
```bash
git add packages/companion-module/src
git -c user.name='XYST' -c user.email='zak@xyst.la' commit -m "feat(companion): config, actions, feedbacks and module entry"
```

---

## Task C6: Verify + docs

- [ ] **Step 1: Package green.** `pnpm --filter @xyst/companion-module test` (10 tests) + `pnpm --filter @xyst/companion-module typecheck`. Then `pnpm -r test` + `pnpm -r typecheck` (whole monorepo) green.
- [ ] **Step 2: README** — add a "## Companion module" subsection under the Local API section: it's at `packages/companion-module`, point Companion's "Developer modules path" at this repo's `packages/companion-module`, set the connection's host/port to the app's API (`127.0.0.1:8088`), then use the actions/feedbacks/variables. Note the two-stage story: Generic HTTP (Stage 1) works today; this native module (Stage 2) adds feedbacks + variables.
- [ ] **Step 3: CLAUDE.md** — mark Phase 7 in the build-plan table as ✅ code-complete (gate: load in Companion + Stream Deck shows REC + ISO — rides with the hardware session). Add a Decisions-log bullet: Companion module is a separate package that is a pure REST/SSE client of the app API (type-only `@xyst/core` import), so no duplicated camera logic; built with `@companion-module/tools`.
- [ ] **Step 4: Commit docs.**

---

## Self-review notes (author)
- **Spec coverage (kickoff §3 Stage 2):** separate `companion-module-base` TS package ✓; actions for all controls (record per-camera/global/toggle, set ISO/shutter/iris/WB/Kelvin/ND, recall preset) ✓; feedbacks for REC/tally (red while recording) ✓; variables for ISO/shutter/iris/WB/ND + status/model per camera ✓; shares the same command layer — it calls the REST API, never re-implements camera logic ✓.
- **No hardware needed:** API client, store, and SSE parser are unit-tested; the glue is typecheck-gated; live behavior was already proven by the Phase 3 sim run.
- **Decoupling:** runtime dependency only on `@companion-module/base`; `@xyst/core` is **type-only** (tree-shaken) — the module is a true API client that would run inside Companion against the app over the network.
- **Intended simplifications:** camera dropdowns are populated at init/config-update from `GET /api/cameras` (a camera added later needs a connection refresh — acceptable; matches how most modules handle dynamic targets); preset recall is by id (operators store the id on a button) — a future enhancement could list presets as a dropdown.
