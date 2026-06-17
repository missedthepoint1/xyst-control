# Release-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make XYST CONTROL ready for production direct distribution (Developer ID + notarized) by adding an auto-updater and closing the top security/packaging findings from the release-readiness audit.

**Architecture:** Five workstreams — (B) lock down the loopback REST API with a Host-header allow-list + bearer token, (C) harden the Electron shell (navigation lockdown, scoped media grant, CSP), (A) add a live-production-safe auto-updater via `electron-updater` against public GitHub Releases, (D) sync versions + codify the DMG notarize/staple step, (E) add a top-level crash guard. Order: B → C → A → D → E.

**Tech Stack:** TypeScript monorepo (pnpm). `@xyst/core` (node:http API server, vitest). `@xyst/app` (Electron main + React renderer via electron-vite + electron-builder). `@xyst/companion-module` (REST/SSE client). `electron-updater` (new). `node:crypto` for the token.

**Reference spec:** `docs/superpowers/specs/2026-06-17-release-readiness-design.md`

**Version target:** this work ships as **0.5.0** (the installed 0.4.0 → 0.5.0 bump is also the first auto-update test).

---

## Workstream B — Local API hardening (audit C1, the release-blocker)

Design: `createApiServer` gains an optional `token`. When set, every request (except `GET /api/health` and `OPTIONS` preflight) must (1) carry a `Host` header whose hostname is loopback, and (2) present the token via `Authorization: Bearer <t>` **or** a `?token=<t>` query param. Wildcard CORS is replaced by echoing the request `Origin`. When no token is passed (existing tests), auth is skipped — backwards compatible.

### Task B1: Core — Host-header + bearer-token auth in the API server

**Files:**
- Modify: `packages/core/src/server/api.ts`
- Test: `packages/core/test/api-auth.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/api-auth.test.ts`:

```ts
import { describe, it, expect, afterEach } from 'vitest';
import type { AddressInfo } from 'node:net';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';
import { createApiServer } from '../src/server/api.js';

const TOKEN = 'test-token-123';
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
  server = createApiServer(mgr, { token: TOKEN });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

describe('REST API auth', () => {
  it('401s a request with no token', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras`)).status).toBe(401);
  });

  it('allows a request with a valid Bearer token', async () => {
    await setup();
    const res = await fetch(`${base}/api/cameras`, { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
  });

  it('allows a valid ?token= query param (for img/EventSource)', async () => {
    await setup();
    expect((await fetch(`${base}/api/cameras?token=${TOKEN}`)).status).toBe(200);
  });

  it('401s a wrong token', async () => {
    await setup();
    const res = await fetch(`${base}/api/cameras`, { headers: { authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });

  it('allows /api/health without a token', async () => {
    await setup();
    expect((await fetch(`${base}/api/health`)).status).toBe(200);
  });

  it('rejects a non-loopback Host header (DNS-rebinding guard)', async () => {
    await setup();
    const res = await fetch(`${base}/api/cameras?token=${TOKEN}`, { headers: { host: 'evil.example.com' } });
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @xyst/core test -- api-auth`
Expected: FAIL (requests currently return 200/404, not 401/403).

- [ ] **Step 3: Implement the auth gate**

In `packages/core/src/server/api.ts`:

(a) Extend the options interface (top of file, replacing the existing `ApiServerOptions`):

```ts
export interface ApiServerOptions { sse?: boolean; token?: string }
```

(b) Capture the token and pass it into `handle`. Change the bottom `return createServer(...)` line:

```ts
  const token = _opts.token;
  return createServer((req, res) => void handle(router, req, res, token));
}
```

(c) Replace the `handle` signature and its `cors(res)` preamble. Replace the existing `handle` function header and the first three lines:

```ts
async function handle(router: Router, req: IncomingMessage, res: ServerResponse, token?: string): Promise<void> {
  cors(res, req);
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
  const url = new URL(req.url ?? '/', 'http://x');
  if (token && url.pathname !== '/api/health') {
    if (!hostIsLoopback(req.headers.host)) return send(res, 403, { error: 'forbidden host' });
    if (!tokenOk(req, url, token)) return send(res, 401, { error: 'unauthorized' });
  }
  const m = router.match(req.method ?? 'GET', url.pathname);
```

(d) Replace the `cors` function (origin-echo instead of wildcard) and add the two helpers:

```ts
function cors(res: ServerResponse, req: IncomingMessage): void {
  // Echo the caller's Origin rather than '*'; the bearer token is the real gate, this just lets
  // the first-party renderer (Origin "null" under file://) read responses.
  const origin = (req.headers.origin as string) || '*';
  res.setHeader('access-control-allow-origin', origin);
  res.setHeader('access-control-allow-methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,authorization');
}

function hostIsLoopback(host: string | undefined): boolean {
  if (!host) return false;
  const name = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase();
  return name === '127.0.0.1' || name === 'localhost' || name === '::1';
}

function tokenOk(req: IncomingMessage, url: URL, token: string): boolean {
  const auth = req.headers.authorization;
  const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7) : undefined;
  const provided = bearer ?? url.searchParams.get('token') ?? undefined;
  return provided !== undefined && provided.length === token.length && timingSafeEqualStr(provided, token);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i % b.length);
  return diff === 0;
}
```

(e) Remove the now-redundant per-route `'access-control-allow-origin': '*'` headers. In the `preview.jpg` route change line 95 to drop that key:

```ts
    res.writeHead(200, { 'content-type': frame.contentType, 'cache-control': 'no-store' });
```

and in the `/api/events` route remove the `'access-control-allow-origin': '*',` line from the `writeHead` object (leave the other three headers).

- [ ] **Step 4: Run the new test + the full core suite**

Run: `pnpm --filter @xyst/core test`
Expected: PASS — the new `api-auth` tests pass AND the existing `api.test.ts` (which calls `createApiServer(mgr)` with no token) still passes because auth is skipped when `token` is undefined.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/server/api.ts packages/core/test/api-auth.test.ts
git commit -m "feat(core): bearer-token + loopback Host guard on the local API"
```

### Task B2: App — generate/persist the token and pass it to the server + renderer

**Files:**
- Create: `packages/app/src/main/api-token.ts`
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 1: Create the token store**

Create `packages/app/src/main/api-token.ts`:

```ts
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

/**
 * A stable per-install bearer token for the loopback REST API, persisted in userData so it
 * survives restarts (the operator pastes it into Companion once). Generated on first run.
 */
export function resolveApiToken(): string {
  const file = join(app.getPath('userData'), 'api-token');
  if (existsSync(file)) {
    const t = readFileSync(file, 'utf8').trim();
    if (t) return t;
  }
  const token = randomBytes(32).toString('hex');
  writeFileSync(file, token, { mode: 0o600 });
  return token;
}
```

- [ ] **Step 2: Wire it into main**

In `packages/app/src/main/index.ts`:

(a) add the import after the `resolveApiPort` import:

```ts
import { resolveApiToken } from './api-token.js';
```

(b) in `main()`, replace the `const api = createApiServer(mgr);` line and the `app:apiBase` handler block with:

```ts
  const apiToken = resolveApiToken();
  const api = createApiServer(mgr, { token: apiToken });
```

and after `const apiBase = ...`:

```ts
  ipcMain.handle('app:apiBase', () => apiBase);
  ipcMain.handle('app:apiToken', () => apiToken);
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/api-token.ts packages/app/src/main/index.ts
git commit -m "feat(app): generate + persist the API bearer token, expose over IPC"
```

### Task B3: Renderer — send the token on preview + meta requests

**Files:**
- Create: `packages/app/src/renderer/hooks/useApiToken.ts`
- Modify: `packages/app/src/preload/index.ts`
- Modify: `packages/app/src/renderer/components/VideoPanel.tsx`

- [ ] **Step 1: Expose the token through the preload bridge**

In `packages/app/src/preload/index.ts`, add right after the `getApiBase` line (line 53):

```ts
  getApiToken: () => ipcRenderer.invoke('app:apiToken') as Promise<string>,
```

- [ ] **Step 2: Add the token hook**

Create `packages/app/src/renderer/hooks/useApiToken.ts` (mirrors `useApiBase.ts`):

```ts
import { useEffect, useState } from 'react';

let cached = '';
export function useApiToken(): string {
  const [token, setToken] = useState(cached);
  useEffect(() => {
    if (cached) return;
    void window.xyst.getApiToken().then((t) => { cached = t; setToken(t); });
  }, []);
  return token;
}

/** Append the token as a query param (img/EventSource can't set headers). Url already has `?t=`. */
export function withToken(url: string, token: string): string {
  if (!token) return url;
  return `${url}${url.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}`;
}
```

- [ ] **Step 3: Use the token in VideoPanel**

In `packages/app/src/renderer/components/VideoPanel.tsx`:

(a) add the import after the `useVideoInputs` import (line 6):

```ts
import { useApiToken, withToken } from '../hooks/useApiToken.js';
```

(b) inside the component, after `const type = source?.type ?? 'none';` (line 25):

```ts
  const token = useApiToken();
```

(c) in the preview effect, change the guard (line 38) and the `load` URL (line 41), and add `token` to the deps (line 56):

```ts
    if (type !== 'protocol' || !apiBase || !token) return;
```
```ts
    const load = () => { if (!stopped) img.src = withToken(`${apiBase}/api/cameras/${cameraId}/preview.jpg?t=${Date.now()}`, token); };
```
```ts
  }, [type, apiBase, cameraId, token]);
```

(d) in the meta effect, change the guard (line 59), the fetch URL (line 63), and the deps (line 71):

```ts
    if (type === 'none' || !apiBase || !token || !showOsd) { setBoxes([]); setGuide(null); return; }
```
```ts
        const r = await fetch(withToken(`${apiBase}/api/cameras/${cameraId}/meta?t=${Date.now()}`, token));
```
```ts
  }, [type, apiBase, cameraId, showOsd, token]);
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/preload/index.ts packages/app/src/renderer/hooks/useApiToken.ts packages/app/src/renderer/components/VideoPanel.tsx
git commit -m "feat(app): authenticate renderer preview + meta requests with the API token"
```

### Task B4: Companion — token config field + Authorization header

**Files:**
- Modify: `packages/companion-module/src/config.ts`
- Modify: `packages/companion-module/src/api.ts`
- Modify: `packages/companion-module/src/sse.ts`
- Modify: `packages/companion-module/src/index.ts`

- [ ] **Step 1: Add the token to config**

Replace the contents of `packages/companion-module/src/config.ts`:

```ts
import type { SomeCompanionConfigField } from '@companion-module/base';

export interface XystConfig { host: string; port: number; token: string }

export function getConfigFields(): SomeCompanionConfigField[] {
  return [
    { type: 'textinput', id: 'host', label: 'XYST app host', width: 6, default: '127.0.0.1' },
    { type: 'number', id: 'port', label: 'API port', width: 6, default: 8088, min: 1, max: 65535 },
    { type: 'textinput', id: 'token', label: 'API token (from the app)', width: 12, default: '' },
  ];
}

export const baseUrl = (c: XystConfig): string => `http://${c.host || '127.0.0.1'}:${c.port || 8088}`;

/** Authorization header for the app's bearer-token gate (empty object when no token configured). */
export const authHeaders = (c: XystConfig): Record<string, string> =>
  c.token ? { authorization: `Bearer ${c.token}` } : {};
```

- [ ] **Step 2: Send the header from the REST client**

In `packages/companion-module/src/api.ts`, replace the constructor and `req` header line:

```ts
export class XystApiClient {
  constructor(private base: string, private authHeader: Record<string, string> = {}) {}

  private async req(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(`${this.base}${path}`, {
      method,
      headers: {
        ...this.authHeader,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
```

- [ ] **Step 3: Send the header on the SSE subscription**

In `packages/companion-module/src/sse.ts`, change `subscribeEvents` to accept extra headers. Replace the signature (line 39-43) and the `fetch` call (line 51):

```ts
export function subscribeEvents(
  url: string,
  onEvent: (event: string, data: string) => void,
  onError?: (err: Error) => void,
  headers: Record<string, string> = {},
): SseHandle {
```
```ts
        const res = await fetch(url, { signal: ctrl.signal, headers: { accept: 'text/event-stream', ...headers } });
```

- [ ] **Step 4: Thread the token through index.ts**

In `packages/companion-module/src/index.ts`:

(a) update the import (line 3):

```ts
import { type XystConfig, getConfigFields, baseUrl, authHeaders } from './config.js';
```

(b) in `start()`, update the client construction (line 36) and the SSE subscription (line 50-52):

```ts
    this.api = new XystApiClient(baseUrl(this.cfg), authHeaders(this.cfg));
```
```ts
    this.sse = subscribeEvents(`${baseUrl(this.cfg)}/api/events`,
      (event, data) => this.onEvent(event, data),
      () => this.updateStatus(InstanceStatus.ConnectionFailure),
      authHeaders(this.cfg));
```

- [ ] **Step 5: Typecheck + test**

Run: `pnpm --filter @xyst/companion-module typecheck && pnpm --filter @xyst/companion-module test`
Expected: PASS (the 12 companion tests still pass; `XystApiClient`'s second arg is optional so existing test construction is unaffected).

- [ ] **Step 6: Commit**

```bash
git add packages/companion-module/src/config.ts packages/companion-module/src/api.ts packages/companion-module/src/sse.ts packages/companion-module/src/index.ts
git commit -m "feat(companion): send the API bearer token on REST + SSE requests"
```

---

## Workstream C — Electron shell hardening (audit H1, H2)

### Task C1: Navigation lockdown, scoped media grant, production CSP

**Files:**
- Modify: `packages/app/src/main/index.ts`

> Not unit-tested (Electron runtime integration); verified by typecheck + a manual launch. CSP is applied only in packaged builds so it can't break the Vite dev server's HMR/websocket.

- [ ] **Step 1: Add a first-party-origin helper + navigation lockdown + scoped media grant + CSP**

In `packages/app/src/main/index.ts`, add this helper above `main()`:

```ts
/** True when a URL is the app's own renderer (file:// in prod, or the dev server in dev). */
function isFirstParty(url: string): boolean {
  if (url.startsWith('file://')) return true;
  const dev = process.env.ELECTRON_RENDERER_URL;
  return !!dev && url.startsWith(dev);
}
```

Then in `main()`, replace the existing `setPermissionRequestHandler` line (line 96) with the block below, and add the navigation + CSP setup right after it:

```ts
  // Grant camera/mic only to first-party content (SDI/HDMI capture-card live view). Any other
  // origin (should never happen — we never navigate away) is denied.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) =>
    cb(permission === 'media' && isFirstParty(wc.getURL())));

  // Lock the shell down: deny all window.open, block navigation away from first-party content.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const block = (e: Electron.Event, url: string) => { if (!isFirstParty(url)) e.preventDefault(); };
    contents.on('will-navigate', block);
    contents.on('will-redirect', block);
  });

  // Content-Security-Policy on the renderer. Packaged-only: a strict CSP would break the Vite dev
  // server's inline HMR client + websocket. img/connect allow the loopback API (preview + SSE).
  if (app.isPackaged) {
    session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
      cb({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; " +
            "img-src 'self' http://127.0.0.1:* http://localhost:* data: blob:; " +
            "media-src 'self' blob:; " +
            "connect-src 'self' http://127.0.0.1:* http://localhost:*; " +
            "script-src 'self'; style-src 'self' 'unsafe-inline'",
          ],
        },
      });
    });
  }
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 3: Manual launch sanity check**

Run: `pnpm dev`
Expected: app launches, panels render, capture-card live view + protocol preview still work (HMR unaffected — CSP is packaged-only). Stop the app after confirming.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(app): navigation lockdown, first-party media grant, packaged-build CSP"
```

---

## Workstream A — Auto-updater

### Task A0: Scaffold a vitest setup for the app package

**Files:**
- Create: `packages/app/vitest.config.ts`
- Modify: `packages/app/package.json`

- [ ] **Step 1: Add the vitest config**

Create `packages/app/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 2: Add a test script**

In `packages/app/package.json`, add to `scripts` (after `"package:dir"`):

```json
    "test": "vitest run"
```

- [ ] **Step 3: Verify the runner is wired (no tests yet is OK)**

Run: `pnpm --filter @xyst/app test`
Expected: vitest runs and reports "No test files found" (exit 0) — confirms the runner resolves. (If it exits non-zero on no files, that's fine; the next task adds files.)

- [ ] **Step 4: Commit**

```bash
git add packages/app/vitest.config.ts packages/app/package.json
git commit -m "chore(app): add vitest runner for main-process unit tests"
```

### Task A1: Add the electron-updater dependency

**Files:**
- Modify: `packages/app/package.json`

- [ ] **Step 1: Install**

Run: `pnpm --filter @xyst/app add electron-updater`
Expected: `electron-updater` appears in `packages/app/package.json` `dependencies`.

- [ ] **Step 2: Commit**

```bash
git add packages/app/package.json pnpm-lock.yaml
git commit -m "chore(app): add electron-updater dependency"
```

### Task A2: Pure update-status helpers (TDD)

**Files:**
- Create: `packages/app/src/main/updateState.ts`
- Test: `packages/app/test/updateState.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/updateState.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { shouldNotify } from '../src/main/updateState.js';

describe('shouldNotify', () => {
  it('notifies for a fresh version when nothing is skipped', () => {
    expect(shouldNotify('0.5.0', undefined)).toBe(true);
  });
  it('does not notify when the offered version is the skipped one', () => {
    expect(shouldNotify('0.5.0', '0.5.0')).toBe(false);
  });
  it('notifies for a different version than the skipped one', () => {
    expect(shouldNotify('0.6.0', '0.5.0')).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @xyst/app test -- updateState`
Expected: FAIL ("Cannot find module ... updateState").

- [ ] **Step 3: Implement**

Create `packages/app/src/main/updateState.ts`:

```ts
/** The update status pushed to the renderer (see preload `onUpdateStatus`). */
export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

/** Surface an available/downloaded update unless the operator already skipped that version. */
export function shouldNotify(offeredVersion: string, skippedVersion: string | undefined): boolean {
  return offeredVersion !== skippedVersion;
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @xyst/app test -- updateState`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/updateState.ts packages/app/test/updateState.test.ts
git commit -m "feat(app): pure update-status types + skip decision"
```

### Task A3: Skip-version store (TDD)

**Files:**
- Create: `packages/app/src/main/update-store.ts`
- Test: `packages/app/test/update-store.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/app/test/update-store.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createUpdateStore } from '../src/main/update-store.js';

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'xyst-upd-')), 'update.json');
}

describe('update store', () => {
  it('returns undefined when nothing is skipped', () => {
    const s = createUpdateStore(tmpFile());
    expect(s.getSkipped()).toBeUndefined();
  });
  it('persists and reads back a skipped version', () => {
    const file = tmpFile();
    createUpdateStore(file).setSkipped('0.5.0');
    expect(createUpdateStore(file).getSkipped()).toBe('0.5.0');
  });
  it('tolerates a corrupt file by returning undefined', () => {
    const file = tmpFile();
    const s = createUpdateStore(file);
    s.setSkipped('0.5.0');
    writeFileSync(file, 'not json'); // overwrite with garbage
    expect(createUpdateStore(file).getSkipped()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `pnpm --filter @xyst/app test -- update-store`
Expected: FAIL ("Cannot find module ... update-store").

- [ ] **Step 3: Implement**

Create `packages/app/src/main/update-store.ts`:

```ts
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

export interface UpdateStore {
  getSkipped(): string | undefined;
  setSkipped(version: string): void;
}

/** Tiny JSON store for the skipped update version, persisted at `file` (in userData). */
export function createUpdateStore(file: string): UpdateStore {
  return {
    getSkipped() {
      if (!existsSync(file)) return undefined;
      try {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as { skippedVersion?: string };
        return parsed.skippedVersion;
      } catch {
        return undefined;
      }
    },
    setSkipped(version: string) {
      writeFileSync(file, JSON.stringify({ skippedVersion: version }), 'utf8');
    },
  };
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `pnpm --filter @xyst/app test -- update-store`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/main/update-store.ts packages/app/test/update-store.test.ts
git commit -m "feat(app): persistent skip-version store"
```

### Task A4: Updater wiring (electron-updater → IPC broadcast)

**Files:**
- Create: `packages/app/src/main/updater.ts`

> Electron-runtime integration; verified by typecheck + the manual update gate (Task A8). No unit test (the pure parts are already covered by A2/A3).

- [ ] **Step 1: Implement the updater module**

Create `packages/app/src/main/updater.ts`:

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import electronUpdater from 'electron-updater';
import { createUpdateStore } from './update-store.js';
import { shouldNotify, type UpdateStatus } from './updateState.js';

const { autoUpdater } = electronUpdater;
const SIX_HOURS = 6 * 60 * 60 * 1000;

/**
 * Live-production-safe auto-update: check on launch + every 6h, download in the background, and
 * surface a "downloaded" status to the renderer. NOTHING installs until the operator explicitly
 * chooses "Install & Restart" (autoInstallOnAppQuit = false). Disabled in dev (not packaged).
 */
export function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  const store = createUpdateStore(join(app.getPath('userData'), 'update.json'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false;

  const broadcast = (status: UpdateStatus) => {
    for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status);
  };

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => {
    if (!shouldNotify(info.version, store.getSkipped())) return; // operator skipped this version
    broadcast({ state: 'available', version: info.version });
  });
  autoUpdater.on('update-not-available', () => broadcast({ state: 'idle' }));
  autoUpdater.on('download-progress', (p) => broadcast({ state: 'downloading', version: autoUpdater.currentVersion?.raw ?? '', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (info) => {
    if (!shouldNotify(info.version, store.getSkipped())) return;
    broadcast({ state: 'downloaded', version: info.version });
  });
  autoUpdater.on('error', (err) => broadcast({ state: 'error', message: err?.message ?? String(err) }));

  const check = () => { void autoUpdater.checkForUpdates().catch(() => { /* offline: silent no-op */ }); };
  check();
  setInterval(check, SIX_HOURS);
}

/** Persist a skip so this version never notifies again. */
export function skipUpdateVersion(version: string): void {
  createUpdateStore(join(app.getPath('userData'), 'update.json')).setSkipped(version);
}

/** Quit and install the downloaded update (operator-triggered "Install & Restart"). */
export function installDownloadedUpdate(): void {
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/main/updater.ts
git commit -m "feat(app): electron-updater wiring (background download, no auto-install)"
```

### Task A5: Wire the updater into main + IPC + preload

**Files:**
- Modify: `packages/app/src/main/index.ts`
- Modify: `packages/app/src/preload/index.ts`

- [ ] **Step 1: Start the updater + handle renderer actions in main**

In `packages/app/src/main/index.ts`:

(a) add the import after `resolveApiToken`:

```ts
import { setupAutoUpdater, skipUpdateVersion, installDownloadedUpdate } from './updater.js';
```

(b) in `main()`, after `installMenu();`, add:

```ts
  setupAutoUpdater();
  ipcMain.handle('update:install', () => installDownloadedUpdate());
  ipcMain.handle('update:skip', (_e, version: string) => skipUpdateVersion(version));
```

- [ ] **Step 2: Expose the update API in preload**

In `packages/app/src/preload/index.ts`, add after `getApiToken` (from Task B3):

```ts
  onUpdateStatus: (cb: (status: unknown) => void) => {
    const h = (_e: unknown, status: unknown) => cb(status);
    ipcRenderer.on('update:status', h);
    return () => ipcRenderer.off('update:status', h);
  },
  installUpdate: () => ipcRenderer.invoke('update:install'),
  skipUpdate: (version: string) => ipcRenderer.invoke('update:skip', version),
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/main/index.ts packages/app/src/preload/index.ts
git commit -m "feat(app): start auto-updater + update IPC handlers + preload bridge"
```

### Task A6: Renderer update banner

**Files:**
- Create: `packages/app/src/renderer/hooks/useUpdateStatus.ts`
- Create: `packages/app/src/renderer/components/UpdateBanner.tsx`
- Modify: `packages/app/src/renderer/main.tsx`
- Modify: `packages/app/src/renderer/app.css` (append styles)

- [ ] **Step 1: Add the status hook**

Create `packages/app/src/renderer/hooks/useUpdateStatus.ts`:

```ts
import { useEffect, useState } from 'react';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };

export function useUpdateStatus(): UpdateStatus {
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => window.xyst.onUpdateStatus((s) => setStatus(s as UpdateStatus)), []);
  return status;
}
```

- [ ] **Step 2: Add the banner component**

Create `packages/app/src/renderer/components/UpdateBanner.tsx`:

```ts
import { useState } from 'react';
import { useUpdateStatus } from '../hooks/useUpdateStatus.js';

/**
 * Non-intrusive update banner. Shows only once an update is fully downloaded; the operator
 * chooses when to restart. "Later" hides it for this session; "Skip" suppresses this version
 * permanently. Nothing ever restarts on its own.
 */
export function UpdateBanner() {
  const status = useUpdateStatus();
  const [dismissed, setDismissed] = useState(false);
  if (status.state !== 'downloaded' || dismissed) return null;
  return (
    <div className="update-banner" role="status">
      <span className="update-banner__msg">Update {status.version} ready</span>
      <button className="btn btn--accent" onClick={() => window.xyst.installUpdate()}>Install &amp; Restart</button>
      <button className="btn btn--ghost" onClick={() => { void window.xyst.skipUpdate(status.version); setDismissed(true); }}>Skip this version</button>
      <button className="btn btn--ghost" onClick={() => setDismissed(true)}>Later</button>
    </div>
  );
}
```

- [ ] **Step 3: Mount it in the main app (not the popout)**

In `packages/app/src/renderer/main.tsx`:

(a) add the import after the `ErrorBoundary` import (line 11):

```ts
import { UpdateBanner } from './components/UpdateBanner.js';
```

(b) render it inside `App`, immediately after the `<AppShell ...>` opening — place `<UpdateBanner />` as the first child. Change the line `      {selected ? (` to:

```tsx
      <UpdateBanner />
      {selected ? (
```

- [ ] **Step 4: Add styles**

Append to `packages/app/src/renderer/app.css`:

```css
.update-banner {
  display: flex; align-items: center; gap: 10px;
  margin: 8px 12px; padding: 8px 12px;
  background: var(--panel, #14181d); border: 1px solid var(--accent, #3b82f6);
  border-radius: 8px; font-size: 13px;
}
.update-banner__msg { margin-right: auto; font-weight: 600; }
```

- [ ] **Step 5: Typecheck + launch**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS. (The banner only renders in the `downloaded` state, which won't fire in dev — that's expected; the manual gate in A8 exercises it.)

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer/hooks/useUpdateStatus.ts packages/app/src/renderer/components/UpdateBanner.tsx packages/app/src/renderer/main.tsx packages/app/src/renderer/app.css
git commit -m "feat(app): update-ready banner (install / skip / later)"
```

### Task A7: electron-builder — zip target + GitHub publish feed

**Files:**
- Modify: `packages/app/electron-builder.yml`

- [ ] **Step 1: Add the zip target and publish block**

In `packages/app/electron-builder.yml`:

(a) change the `mac.target` list (lines 22-23) to include `zip` (required for electron-updater on macOS; the dmg stays as the human download):

```yaml
  target:
    - dmg
    - zip
```

(b) add a top-level `publish:` block (sets the update feed + makes electron-builder emit `latest-mac.yml` / `latest.yml`). Append at the end of the file (owner/repo taken from the `origin` remote `git@github.com:missedthepoint1/xyst-control.git`):

```yaml
publish:
  provider: github
  owner: missedthepoint1
  repo: xyst-control
```

- [ ] **Step 2: Confirm the GitHub owner/repo still matches**

Run: `git remote get-url origin`
Expected: `git@github.com:missedthepoint1/xyst-control.git` — confirms the `publish` owner/repo. Update them if the remote has changed.

- [ ] **Step 3: Commit**

```bash
git add packages/app/electron-builder.yml
git commit -m "build(app): zip target + GitHub publish feed for auto-update"
```

### Task A8: Manual update round-trip gate (documented, not automated)

> This cannot be unit-tested — it needs a signed build + a real GitHub release. Record the procedure; run it when cutting 0.5.0.

- [ ] **Step 1: Document the gate**

Append to `README.md` under a new `## Auto-update` section:

```markdown
## Auto-update

The app checks GitHub Releases on launch + every 6h, downloads in the background, and shows an
"Update N ready" banner. Nothing installs until the operator clicks **Install & Restart**.

**Release + update test:**
1. Ensure a prior signed release (e.g. 0.4.0) is installed.
2. Bump to the new version, `pnpm package`, sign + notarize + staple the artifacts
   (`scripts/notarize-dmg.sh`).
3. Publish the new release to GitHub Releases with the `.dmg`, `.zip`, and `latest-mac.yml`
   (and the Windows `.exe` + `latest.yml`).
4. Launch the installed older build → confirm the banner appears → **Install & Restart** →
   app relaunches on the new version. Test **Skip this version** suppresses re-notify.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: auto-update behavior + release/update test gate"
```

---

## Workstream D — Release hygiene (audit H3, M1)

### Task D1: Sync all versions to 0.5.0

**Files:**
- Modify: `package.json`, `packages/core/package.json`, `packages/app/package.json`, `packages/companion-module/package.json`, `packages/companion-module/pkg/package.json`, `packages/companion-module/companion/manifest.json`

- [ ] **Step 1: Set every version to 0.5.0**

Set the `"version"` field to `"0.5.0"` in each of:
- `package.json` (currently 0.1.0)
- `packages/core/package.json` (0.1.0)
- `packages/app/package.json` (0.4.0)
- `packages/companion-module/package.json` (0.1.0)
- `packages/companion-module/pkg/package.json` (0.1.0)
- `packages/companion-module/companion/manifest.json` (currently **0.0.0** — the most visible bug)

- [ ] **Step 2: Verify they all agree**

Run: `grep -H '"version"' package.json packages/*/package.json packages/companion-module/pkg/package.json packages/companion-module/companion/manifest.json`
Expected: every line shows `0.5.0`.

- [ ] **Step 3: Commit**

```bash
git add package.json packages/core/package.json packages/app/package.json packages/companion-module/package.json packages/companion-module/pkg/package.json packages/companion-module/companion/manifest.json
git commit -m "chore: sync all package + Companion manifest versions to 0.5.0"
```

### Task D2: Codify DMG notarize + staple

**Files:**
- Create: `scripts/notarize-dmg.sh`

- [ ] **Step 1: Write the script**

Create `scripts/notarize-dmg.sh`:

```bash
#!/usr/bin/env bash
# Sign, notarize, and staple the built DMG so Gatekeeper trusts it offline.
# Credentials come from ~/.xyst-notarize.env (out of repo):
#   APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID, APPLE_SIGN_IDENTITY
# APPLE_SIGN_IDENTITY example: "Developer ID Application: Zak Smith (8R445A26FP)"
set -euo pipefail

ENV_FILE="${XYST_NOTARIZE_ENV:-$HOME/.xyst-notarize.env}"
[ -f "$ENV_FILE" ] || { echo "missing $ENV_FILE" >&2; exit 1; }
# shellcheck disable=SC1090
source "$ENV_FILE"

DMG="${1:-}"
if [ -z "$DMG" ]; then
  DMG="$(ls -t packages/app/release/*.dmg 2>/dev/null | head -1 || true)"
fi
[ -n "$DMG" ] && [ -f "$DMG" ] || { echo "DMG not found (pass a path or run pnpm package first)" >&2; exit 1; }

echo "Signing $DMG"
codesign --force --sign "$APPLE_SIGN_IDENTITY" "$DMG"

echo "Submitting for notarization (this can take a few minutes)…"
xcrun notarytool submit "$DMG" \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_APP_SPECIFIC_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

echo "Stapling"
xcrun stapler staple "$DMG"

echo "Verifying"
spctl -a -t open --context context:primary-signature "$DMG"
echo "Done: $DMG"
```

- [ ] **Step 2: Make it executable + confirm the signing identity exists**

Run: `chmod +x scripts/notarize-dmg.sh && security find-identity -v -p codesigning | grep "Developer ID Application"`
Expected: the `chmod` succeeds and the identity line is printed (confirm it matches `APPLE_SIGN_IDENTITY`). If the identity name differs, note it in `~/.xyst-notarize.env`.

- [ ] **Step 3: Commit**

```bash
git add scripts/notarize-dmg.sh
git commit -m "build: script the DMG sign + notarize + staple step"
```

---

## Workstream E — Crash guard (audit M4)

### Task E1: Top-level uncaughtException / unhandledRejection handlers

**Files:**
- Modify: `packages/app/src/main/index.ts`

- [ ] **Step 1: Add the handlers at module top**

In `packages/app/src/main/index.ts`, immediately after `app.setName('XYST CONTROL');` (line 10), add:

```ts
// Never let a stray async throw take down the app mid-show — log and keep running. Local only;
// no remote crash upload (the app sends nothing off-machine).
process.on('uncaughtException', (err) => console.error('[uncaughtException]', err));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]', reason));
```

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @xyst/app typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/main/index.ts
git commit -m "feat(app): top-level crash guard keeps the app alive on stray errors"
```

---

## Final verification

- [ ] **Full typecheck:** `pnpm -r typecheck` → PASS (core, app, companion).
- [ ] **Full test suite:** `pnpm -r test` → PASS (existing 117 + new core api-auth tests + new app updateState/update-store tests).
- [ ] **Manual launch:** `pnpm dev` → app runs, control + live view work, no console errors from the new auth path (renderer uses the token).
- [ ] **Manual cross-origin reject (Part B proof):** with the app running, from a browser console on any site run `fetch('http://127.0.0.1:8088/api/cameras')` → rejected (401/blocked), not 200 with data.
- [ ] **Packaging:** `pnpm package` then `scripts/notarize-dmg.sh` → stapled DMG passes `spctl`.
- [ ] **Update gate (at release):** follow README "Release + update test" — installed 0.4.0 picks up 0.5.0, banner shows, Install & Restart works, Skip suppresses.
```
