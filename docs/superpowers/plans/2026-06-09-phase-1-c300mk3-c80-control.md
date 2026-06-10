# XYST CONTROL — Phase 1 (C300 Mk III + C80 control) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A modern dark Electron app that connects to a Canon EOS C300 Mark III (and C80) over the XC Protocol on a wired LAN and gives rock-solid record + full manual exposure control (ISO, shutter, iris-where-supported, white balance, ND), with the UI reflecting the camera's actual state.

**Architecture:** A TypeScript pnpm monorepo. `packages/core` holds the transport-agnostic `CameraDriver` interface, the `XCProtocolDriver`, and the `CameraManager` command layer (the single source of truth — all camera logic lives here). `packages/app` is an Electron app (electron-vite + React) that instantiates `CameraManager` in the main process and drives a capability-discovered UI over IPC. The driver is **capability-driven**: it reads each control's valid values from the camera's own `info.cgi` at connect time, so one driver serves the C300mk3, the C80 (not in the spec), and the C70 without hard-coded model tables.

**Tech Stack:** Node 20+, TypeScript 5, pnpm workspaces, Vitest (unit + fake-camera integration tests), Electron + electron-vite, React 18, Radix UI primitives, plain CSS variables for the dark theme. No camera SDK — pure HTTP CGI to `http://<ip>/-wvhttp-01-/`.

**Protocol reference:** See `CLAUDE.md` → "XC Protocol cheat-sheet" and `docs/xc-protocol-spec.pdf`. Extracted spec text for grepping is at `.work/xc-spec.txt`.

---

## Conventions for this plan

- **TDD for all of `core`** (Tasks 2–9): write the failing test, watch it fail, implement minimally, watch it pass, commit. Core is pure-ish logic + HTTP and is fully testable without a real camera using a **fake XC camera server** (Task 6).
- **Build-and-manually-verify for the Electron/UI layer** (Tasks 10–14): Electron renderer UI is not unit-tested in Phase 1 — it is verified by running the app against the real camera at the Task 14 gate. Pure logic that leaks into the renderer (value formatting, capability gating) is unit-tested in `core` so the renderer stays thin.
- **Commit after every task** (and after each green test within a task). Commit messages use Conventional Commits.
- **Run tests with:** `pnpm --filter @xyst/core test` (or `pnpm test` at root).
- All paths are relative to the repo root `XYST CONTROL/`.

---

## File structure (locked decomposition)

```
package.json                      # root: workspaces, scripts, devDeps (typescript, vitest)
pnpm-workspace.yaml
tsconfig.base.json
.gitignore
.nvmrc
README.md                         # setup + FIRMWARE VERSIONS table
config/cameras.example.json       # sample profile; real cameras.json is gitignored

packages/core/
  package.json                    # @xyst/core
  tsconfig.json
  vitest.config.ts
  src/
    types.ts                      # ConnectionStatus, ControlId, ControlState, CameraSnapshot, CameraProfile, CameraState
    index.ts                      # re-exports
    xc/
      parse.ts                    # parseXcBody(text) -> Record<string,string>  (Task 3)
      interpret.ts                # interpretInfo(map) -> CameraSnapshot         (Task 4)
      auth.ts                     # buildAuthHeader (Basic + Digest)             (Task 5)
      client.ts                   # xcRequest() http with timeout/retry/livescope (Task 6)
      commands.ts                 # buildControlParams(id,value,snapshot)        (Task 7)
      errors.ts                   # XcError, LivescopeError
      driver.ts                   # XCProtocolDriver (CameraDriver impl)         (Task 8)
    driver.ts                     # CameraDriver interface + shared types
    manager.ts                    # CameraManager + profile load/save            (Task 9)
  test/
    fixtures/info-c300mk3.txt     # canned info.cgi body                          (Task 4)
    fake-camera.ts                # in-memory XC camera http server               (Task 6)
    parse.test.ts  interpret.test.ts  auth.test.ts  client.test.ts
    commands.test.ts  driver.test.ts  manager.test.ts

packages/app/
  package.json                    # @xyst/app (electron)
  electron.vite.config.ts
  tsconfig.json   tsconfig.node.json
  src/
    main/
      index.ts                    # BrowserWindow, CameraManager, IPC, state push (Task 10)
      ipc.ts                      # IPC channel handlers
      config-path.ts              # resolves cameras.json under userData
    preload/
      index.ts                    # contextBridge -> window.xyst                 (Task 10)
      api.d.ts                    # XystApi type shared with renderer
    renderer/
      index.html
      main.tsx                    # React root
      theme.css                   # dark design tokens                           (Task 11)
      app.css
      hooks/useCameras.ts         # IPC subscription store                       (Task 11)
      components/
        AppShell.tsx              # layout + header                              (Task 11)
        AddCameraForm.tsx         # manual IP + profile                          (Task 12)
        CameraPanel.tsx           # status + REC + controls host                 (Task 12)
        RecButton.tsx             # REC toggle + state                           (Task 12)
        controls/
          ControlSelect.tsx       # discrete list control                       (Task 13)
          ControlSlider.tsx       # min/max control (iris)                       (Task 13)
          IsoControl.tsx  ShutterControl.tsx  IrisControl.tsx
          WbControl.tsx  NdControl.tsx                                            (Task 13)
```

---

## Task 1: Scaffold the pnpm monorepo and tooling

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `.gitignore`, `.nvmrc`, `README.md`, `config/cameras.example.json`

- [ ] **Step 1: Initialize git and Node version**

Run:
```bash
cd "XYST CONTROL"
git init
node -v   # confirm >= 20
printf '20\n' > .nvmrc
```
Expected: git repo created, Node 20+.

- [ ] **Step 2: Create `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
```

- [ ] **Step 3: Create root `package.json`**

```json
{
  "name": "xyst-control",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "test": "pnpm -r test",
    "typecheck": "pnpm -r typecheck",
    "dev": "pnpm --filter @xyst/app dev",
    "build": "pnpm -r build"
  },
  "devDependencies": {
    "typescript": "^5.5.4",
    "vitest": "^2.0.5",
    "@types/node": "^20.14.0"
  }
}
```

- [ ] **Step 4: Create `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "lib": ["ES2022", "DOM"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true
  }
}
```

- [ ] **Step 5: Create `.gitignore`**

```gitignore
node_modules/
dist/
out/
.work/
config/cameras.json
*.log
.DS_Store
```

- [ ] **Step 6: Create `config/cameras.example.json`**

```json
{
  "cameras": [
    {
      "id": "cam-1",
      "name": "C300 III",
      "driver": "xc",
      "host": "192.168.100.1",
      "auth": { "username": "", "password": "" }
    }
  ]
}
```

- [ ] **Step 7: Create `README.md` with the firmware table**

```markdown
# XYST CONTROL

Wired-IP camera control for Canon cinema bodies. See `CLAUDE.md` for architecture.

## Camera firmware versions (KEEP UPDATED — endpoints can change on firmware updates)

| Camera | Firmware | Verified date |
|---|---|---|
| Canon EOS C300 Mark III | _TBD at first test_ | |
| Canon EOS C80 | _TBD at first test_ | |
| Canon EOS R5 C | _TBD (Phase 4)_ | |

## Setup

```bash
pnpm install
pnpm test          # run all tests
pnpm dev           # launch the Electron app
```

Copy `config/cameras.example.json` to `config/cameras.json` and set your camera IP.
```

- [ ] **Step 8: Install and commit**

Run:
```bash
pnpm install
git add -A
git commit -m "chore: scaffold pnpm monorepo and tooling"
```
Expected: lockfile created, clean install.

---

## Task 2: Core package init and shared types

**Files:**
- Create: `packages/core/package.json`, `packages/core/tsconfig.json`, `packages/core/vitest.config.ts`, `packages/core/src/types.ts`, `packages/core/src/driver.ts`, `packages/core/src/index.ts`

- [ ] **Step 1: Create `packages/core/package.json`**

```json
{
  "name": "@xyst/core",
  "version": "0.1.0",
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit"
  }
}
```

- [ ] **Step 2: Create `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src", "test"]
}
```

- [ ] **Step 3: Create `packages/core/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
});
```

- [ ] **Step 4: Create `packages/core/src/types.ts`**

```ts
export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export type ControlId = 'iso' | 'gain' | 'shutter' | 'iris' | 'wb' | 'wbKelvin' | 'nd';

/** A single discovered control: what it currently is + what values are valid. */
export interface ControlState {
  id: ControlId;
  available: boolean;
  value?: string | number;
  /** Discrete allowed values (e.g. ISO list, ND list, WB presets). */
  list?: Array<string | number>;
  /** Continuous range (e.g. iris abstract value). */
  min?: number;
  max?: number;
  /** Current sub-mode (e.g. shutter.mode = 'speed', wb = 'kelvin'). */
  mode?: string;
  modeList?: string[];
  /** Display hint, e.g. 'K', 'ND', 'dB'. */
  unit?: string;
}

export interface RecordState {
  recording: boolean;
  media1?: string;
  media2?: string;
  remainingMinutes?: number;
}

/** The interpreted result of one info.cgi read. */
export interface CameraSnapshot {
  model?: string;
  exposureMode?: string; // c.1.exp
  record: RecordState;
  controls: Partial<Record<ControlId, ControlState>>;
}

/** The full externally-visible state of a camera. */
export interface CameraState extends CameraSnapshot {
  id: string;
  status: ConnectionStatus;
  updatedAt: number;
  lastError?: string;
}

export interface CameraAuth {
  username?: string;
  password?: string;
}

export interface CameraProfile {
  id: string;
  name: string;
  driver: 'xc' | 'r5c';
  host: string;
  auth?: CameraAuth;
}
```

- [ ] **Step 5: Create `packages/core/src/driver.ts` (interface)**

```ts
import { EventEmitter } from 'node:events';
import type { CameraState, ControlId, ConnectionStatus } from './types.js';

export interface CameraDriverEvents {
  state: (patch: Partial<CameraState>) => void;
  status: (status: ConnectionStatus) => void;
  error: (err: Error) => void;
}

export interface CameraDriver extends EventEmitter {
  readonly id: string;
  readonly status: ConnectionStatus;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getState(): CameraState;
  startRecording(): Promise<void>;
  stopRecording(): Promise<void>;
  setControl(id: ControlId, value: string | number): Promise<void>;
}
```

- [ ] **Step 6: Create `packages/core/src/index.ts`**

```ts
export * from './types.js';
export * from './driver.js';
export { XCProtocolDriver } from './xc/driver.js';
export { CameraManager } from './manager.js';
```

> Note: `index.ts` references files created in later tasks. It will not typecheck until Task 8/9 exist — that is expected; do not run `typecheck` on core until Task 9.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat(core): package init and shared types"
```

---

## Task 3: XC response parser

The XC protocol returns plain-text bodies of `key:=value` (changed) and `key==value` (unchanged) lines. Values can themselves contain `:` (e.g. `s.origin:=192.168.100.1:80`), so split on the **first** `:=` or `==`.

**Files:**
- Create: `packages/core/src/xc/parse.ts`
- Test: `packages/core/test/parse.test.ts`

- [ ] **Step 1: Write the failing test**

`packages/core/test/parse.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { parseXcBody } from '../src/xc/parse.js';

describe('parseXcBody', () => {
  it('parses := and == lines into a flat map', () => {
    const body = [
      'c.1.type:=Canon EOS C300 Mark III',
      'c.1.exp==manual',
      'f.rec.status:=idle',
    ].join('\n');
    expect(parseXcBody(body)).toEqual({
      'c.1.type': 'Canon EOS C300 Mark III',
      'c.1.exp': 'manual',
      'f.rec.status': 'idle',
    });
  });

  it('splits on the first separator so values keep their colons', () => {
    expect(parseXcBody('s.origin:=192.168.100.1:80')).toEqual({
      's.origin': '192.168.100.1:80',
    });
  });

  it('trims whitespace and ignores blank lines', () => {
    expect(parseXcBody('\n  c.1.wb := kelvin \n\n')).toEqual({ 'c.1.wb': 'kelvin' });
  });

  it('last value wins for a repeated key', () => {
    expect(parseXcBody('a:=1\na:=2')).toEqual({ a: '2' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test parse`
Expected: FAIL — cannot find module `../src/xc/parse.js`.

- [ ] **Step 3: Write minimal implementation**

`packages/core/src/xc/parse.ts`:
```ts
/** Parse an XC protocol response body into a flat key→value map. */
export function parseXcBody(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const sepIdx = findSeparator(line);
    if (sepIdx < 0) continue;
    const key = line.slice(0, sepIdx).trim();
    const value = line.slice(sepIdx + 2).trim();
    if (key) out[key] = value;
  }
  return out;
}

/** Index of the first ':=' or '==' separator, or -1. */
function findSeparator(line: string): number {
  const a = line.indexOf(':=');
  const b = line.indexOf('==');
  if (a < 0) return b;
  if (b < 0) return a;
  return Math.min(a, b);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test parse`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/xc/parse.ts packages/core/test/parse.test.ts
git commit -m "feat(core): XC response body parser"
```

---

## Task 4: Interpret info.cgi into a CameraSnapshot

Maps the flat key→value map to the typed `CameraSnapshot`, applying capability gating (a control is `available` only if the camera advertised its key).

**Files:**
- Create: `packages/core/src/xc/interpret.ts`, `packages/core/test/fixtures/info-c300mk3.txt`
- Test: `packages/core/test/interpret.test.ts`

- [ ] **Step 1: Create the fixture** `packages/core/test/fixtures/info-c300mk3.txt`

```text
c:=1
c.count:=1
c.1.type:=Canon EOS C300 Mark III
c.1.status:=enabled
c.1.exp:=manual
c.1.exp.list:=auto,manual
c.1.shooting:=manual
c.1.me.isogain.mode:=iso
c.1.me.isogain.mode.list:=iso,gain
c.1.me.iso.mode:=manual
c.1.me.iso.mode.list:=auto,manual
c.1.me.iso:=800
c.1.me.iso.increment:=3
c.1.me.iso.list:=100,125,160,200,250,320,400,500,640,800,1000,1250,1600,2000,2500,3200,4000,5000,6400,8000,10000,12800,25600,51200,102400
c.1.me.gain:=120
c.1.me.gain.min:=-20
c.1.me.gain.max:=420
c.1.me.shutter.mode:=speed
c.1.me.shutter.mode.list:=auto,speed,slow,angle,clearscan
c.1.me.shutter:=2000
c.1.me.shutter.list:=24,25,30,50,60,100,120,250,500,1000,2000
c.1.me.iris:=200
c.1.me.iris.min:=108
c.1.me.iris.max:=250
c.1.lens.iris:=manual
c.1.wb:=kelvin
c.1.wb.list:=auto,manual,wb_a,wb_b,daylight,tungsten,kelvin
c.1.wb.kelvin:=5600
c.1.wb.kelvin.list:=2500,3200,4300,5600,6500,10000
c.1.nd.mode:=manual
c.1.nd:=on
c.1.nd.filter:=400
c.1.nd.filter.list:=0,400,1600,6400
f.rec.status:=idle
f.rec.media1.status:=recordable
f.rec.media1.remainingtime:=120
```

- [ ] **Step 2: Write the failing test** `packages/core/test/interpret.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseXcBody } from '../src/xc/parse.js';
import { interpretInfo } from '../src/xc/interpret.js';

const fixture = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

describe('interpretInfo', () => {
  const snap = interpretInfo(parseXcBody(fixture));

  it('reads model, exposure mode and record state', () => {
    expect(snap.model).toBe('Canon EOS C300 Mark III');
    expect(snap.exposureMode).toBe('manual');
    expect(snap.record.recording).toBe(false);
    expect(snap.record.remainingMinutes).toBe(120);
  });

  it('reads ISO with its discrete list', () => {
    expect(snap.controls.iso?.available).toBe(true);
    expect(snap.controls.iso?.value).toBe(800);
    expect(snap.controls.iso?.list).toContain(102400);
    expect(snap.controls.iso?.mode).toBe('manual');
  });

  it('reads shutter, wb preset+kelvin and nd', () => {
    expect(snap.controls.shutter?.value).toBe(2000);
    expect(snap.controls.shutter?.mode).toBe('speed');
    expect(snap.controls.wb?.value).toBe('kelvin');
    expect(snap.controls.wbKelvin?.value).toBe(5600);
    expect(snap.controls.nd?.value).toBe(400);
    expect(snap.controls.nd?.list).toEqual([0, 400, 1600, 6400]);
  });

  it('exposes iris as a range only when the lens advertises one', () => {
    expect(snap.controls.iris?.available).toBe(true);
    expect(snap.controls.iris?.min).toBe(108);
    expect(snap.controls.iris?.max).toBe(250);
  });

  it('marks a control unavailable when the camera did not advertise it', () => {
    const snap2 = interpretInfo({ 'c.1.type': 'X', 'f.rec.status': 'rec' });
    expect(snap2.controls.iso).toBeUndefined();
    expect(snap2.record.recording).toBe(true);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test interpret`
Expected: FAIL — cannot find `interpret.js`.

- [ ] **Step 4: Write the implementation** `packages/core/src/xc/interpret.ts`

```ts
import type { CameraSnapshot, ControlState, ControlId } from '../types.js';

type Map = Record<string, string>;

const num = (v: string | undefined): number | undefined => {
  if (v === undefined) return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};

/** Split a comma list, coercing each item to a number when fully numeric. */
const list = (v: string | undefined): Array<string | number> | undefined => {
  if (v === undefined) return undefined;
  return v.split(',').map((s) => {
    const t = s.trim();
    const n = Number(t);
    return t !== '' && Number.isFinite(n) ? n : t;
  });
};

export function interpretInfo(map: Map): CameraSnapshot {
  const controls: Partial<Record<ControlId, ControlState>> = {};

  if ('c.1.me.iso' in map) {
    controls.iso = {
      id: 'iso',
      available: true,
      value: num(map['c.1.me.iso']),
      list: list(map['c.1.me.iso.list']),
      mode: map['c.1.me.iso.mode'],
      modeList: list(map['c.1.me.iso.mode.list'])?.map(String),
    };
  }
  if ('c.1.me.gain' in map) {
    controls.gain = {
      id: 'gain',
      available: true,
      value: num(map['c.1.me.gain']),
      min: num(map['c.1.me.gain.min']),
      max: num(map['c.1.me.gain.max']),
      unit: 'dB',
    };
  }
  if ('c.1.me.shutter' in map) {
    controls.shutter = {
      id: 'shutter',
      available: true,
      value: num(map['c.1.me.shutter']) ?? map['c.1.me.shutter'],
      list: list(map['c.1.me.shutter.list']),
      mode: map['c.1.me.shutter.mode'],
      modeList: list(map['c.1.me.shutter.mode.list'])?.map(String),
    };
  }
  // Iris is offered only when the body+lens advertise a usable range.
  if ('c.1.me.iris' in map && map['c.1.me.iris.min'] !== undefined) {
    controls.iris = {
      id: 'iris',
      available: true,
      value: num(map['c.1.me.iris']),
      min: num(map['c.1.me.iris.min']),
      max: num(map['c.1.me.iris.max']),
    };
  }
  if ('c.1.wb' in map) {
    controls.wb = {
      id: 'wb',
      available: true,
      value: map['c.1.wb'],
      list: list(map['c.1.wb.list']),
    };
  }
  if ('c.1.wb.kelvin' in map) {
    controls.wbKelvin = {
      id: 'wbKelvin',
      available: true,
      value: num(map['c.1.wb.kelvin']),
      list: list(map['c.1.wb.kelvin.list']),
      unit: 'K',
    };
  }
  if ('c.1.nd.filter' in map) {
    controls.nd = {
      id: 'nd',
      available: true,
      value: num(map['c.1.nd.filter']),
      list: list(map['c.1.nd.filter.list']),
      mode: map['c.1.nd.mode'],
    };
  }

  return {
    model: map['c.1.type'],
    exposureMode: map['c.1.exp'],
    record: {
      recording: map['f.rec.status'] === 'rec',
      media1: map['f.rec.media1.status'],
      media2: map['f.rec.media2.status'],
      remainingMinutes: num(map['f.rec.media1.remainingtime']),
    },
    controls,
  };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test interpret`
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/xc/interpret.ts packages/core/test/interpret.test.ts packages/core/test/fixtures/info-c300mk3.txt
git commit -m "feat(core): interpret info.cgi into a typed snapshot"
```

---

## Task 5: HTTP auth header (Basic + Digest)

Canon cameras with User Access Control use HTTP **Digest** auth. We build the header from a `401` challenge. Pure functions = easy to test with RFC 2617 vectors.

**Files:**
- Create: `packages/core/src/xc/auth.ts`
- Test: `packages/core/test/auth.test.ts`

- [ ] **Step 1: Write the failing test** `packages/core/test/auth.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { parseChallenge, buildDigestHeader, buildBasicHeader } from '../src/xc/auth.js';

describe('auth headers', () => {
  it('builds a Basic header', () => {
    expect(buildBasicHeader('user', 'pass')).toBe(
      'Basic ' + Buffer.from('user:pass').toString('base64'),
    );
  });

  it('parses a Digest WWW-Authenticate challenge', () => {
    const c = parseChallenge(
      'Digest realm="cam", nonce="abc", qop="auth", opaque="zz"',
    );
    expect(c).toMatchObject({ scheme: 'digest', realm: 'cam', nonce: 'abc', qop: 'auth', opaque: 'zz' });
  });

  it('builds a deterministic Digest header (fixed cnonce)', () => {
    const header = buildDigestHeader({
      username: 'admin', password: 'secret',
      method: 'GET', uri: '/-wvhttp-01-/info.cgi',
      challenge: { scheme: 'digest', realm: 'cam', nonce: 'n0', qop: 'auth' },
      cnonce: 'deadbeef', nc: 1,
    });
    expect(header).toContain('Digest ');
    expect(header).toContain('username="admin"');
    expect(header).toContain('realm="cam"');
    expect(header).toContain('nc=00000001');
    expect(header).toContain('cnonce="deadbeef"');
    expect(header).toMatch(/response="[0-9a-f]{32}"/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test auth`
Expected: FAIL — cannot find `auth.js`.

- [ ] **Step 3: Write the implementation** `packages/core/src/xc/auth.ts`

```ts
import { createHash } from 'node:crypto';

export interface DigestChallenge {
  scheme: 'digest';
  realm: string;
  nonce: string;
  qop?: string;
  opaque?: string;
  algorithm?: string;
}

const md5 = (s: string) => createHash('md5').update(s).digest('hex');

export function buildBasicHeader(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`).toString('base64');
}

/** Parse a `WWW-Authenticate` value. Returns null if not Digest. */
export function parseChallenge(header: string): DigestChallenge | null {
  if (!/^digest/i.test(header.trim())) return null;
  const body = header.trim().replace(/^digest\s+/i, '');
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(\w+)=(?:"([^"]*)"|([^,]*))/g)) {
    out[m[1].toLowerCase()] = (m[2] ?? m[3] ?? '').trim();
  }
  if (!out.realm || !out.nonce) return null;
  return {
    scheme: 'digest',
    realm: out.realm,
    nonce: out.nonce,
    qop: out.qop?.split(',')[0]?.trim(),
    opaque: out.opaque,
    algorithm: out.algorithm,
  };
}

export function buildDigestHeader(opts: {
  username: string;
  password: string;
  method: string;
  uri: string;
  challenge: DigestChallenge;
  cnonce: string;
  nc: number;
}): string {
  const { username, password, method, uri, challenge, cnonce } = opts;
  const nc = opts.nc.toString(16).padStart(8, '0');
  const ha1 = md5(`${username}:${challenge.realm}:${password}`);
  const ha2 = md5(`${method}:${uri}`);
  const response = challenge.qop
    ? md5(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${challenge.qop}:${ha2}`)
    : md5(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts = [
    `username="${username}"`,
    `realm="${challenge.realm}"`,
    `nonce="${challenge.nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
  ];
  if (challenge.qop) parts.push(`qop=${challenge.qop}`, `nc=${nc}`, `cnonce="${cnonce}"`);
  if (challenge.opaque) parts.push(`opaque="${challenge.opaque}"`);
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  return 'Digest ' + parts.join(', ');
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test auth`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/xc/auth.ts packages/core/test/auth.test.ts
git commit -m "feat(core): HTTP Basic and Digest auth helpers"
```

---

## Task 6: XC HTTP client (timeout, retry, livescope, auth) + fake camera

`xcRequest` is the only thing that touches the network. It enforces a timeout, retries idempotent GETs, maps `livescope-status` to errors, and performs Digest/Basic auth on `401`. A reusable **fake camera server** backs this and later driver tests.

**Files:**
- Create: `packages/core/src/xc/errors.ts`, `packages/core/src/xc/client.ts`, `packages/core/test/fake-camera.ts`
- Test: `packages/core/test/client.test.ts`

- [ ] **Step 1: Create `packages/core/src/xc/errors.ts`**

```ts
export class XcError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'XcError';
  }
}

export class LivescopeError extends XcError {
  constructor(readonly status: number, message: string) {
    super(`livescope-status ${status}: ${message}`);
    this.name = 'LivescopeError';
  }
}
```

- [ ] **Step 2: Create the fake camera** `packages/core/test/fake-camera.ts`

```ts
import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { AddressInfo } from 'node:net';

const infoBody = readFileSync(
  fileURLToPath(new URL('./fixtures/info-c300mk3.txt', import.meta.url)),
  'utf8',
);

export interface FakeCameraOptions {
  /** Require Digest auth with these creds before answering. */
  auth?: { username: string; password: string };
  /** Fail this many requests with a network error before succeeding. */
  failFirst?: number;
}

/** A minimal in-memory XC Protocol camera for tests. */
export class FakeCamera {
  private server: Server;
  private state: Record<string, string> = {};
  private failsLeft: number;
  /** Records of received control.cgi query strings, for assertions. */
  readonly controlLog: string[] = [];

  constructor(private opts: FakeCameraOptions = {}) {
    this.failsLeft = opts.failFirst ?? 0;
    // seed mutable state from the fixture
    for (const line of infoBody.split('\n')) {
      const i = line.indexOf(':=');
      if (i > 0) this.state[line.slice(0, i).trim()] = line.slice(i + 2).trim();
    }
    this.server = createServer((req, res) => this.handle(req, res));
  }

  async listen(): Promise<string> {
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    const { port } = this.server.address() as AddressInfo;
    return `127.0.0.1:${port}`;
  }
  async close(): Promise<void> {
    await new Promise<void>((r) => this.server.close(() => r()));
  }

  private handle(req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) {
    if (this.failsLeft > 0) { this.failsLeft--; req.destroy(); return; }

    if (this.opts.auth && !req.headers.authorization) {
      res.writeHead(401, {
        'www-authenticate': 'Digest realm="cam", nonce="testnonce", qop="auth"',
      });
      res.end();
      return;
    }

    const url = new URL(req.url ?? '', 'http://x');
    const cmd = url.pathname.replace('/-wvhttp-01-/', '');

    if (cmd === 'control.cgi') {
      this.controlLog.push(url.search.slice(1));
      for (const [k, v] of url.searchParams) {
        if (k.startsWith('c.') || k.startsWith('f.')) this.state[k] = v;
      }
      // mirror f.rec=on/off into f.rec.status
      const rec = url.searchParams.get('f.rec');
      if (rec === 'on') this.state['f.rec.status'] = 'rec';
      if (rec === 'off') this.state['f.rec.status'] = 'idle';
    }

    const body = Object.entries(this.state).map(([k, v]) => `${k}:=${v}`).join('\n');
    res.writeHead(200, {
      'content-type': 'text/plain;charset=utf-8',
      'livescope-status': '0',
    });
    res.end(body);
  }
}
```

- [ ] **Step 3: Write the failing test** `packages/core/test/client.test.ts`

```ts
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

  it('throws LivescopeError on a non-zero livescope status', async () => {
    // a tiny server returning livescope-status 403
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
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test client`
Expected: FAIL — cannot find `client.js`.

- [ ] **Step 5: Write the implementation** `packages/core/src/xc/client.ts`

```ts
import { randomBytes } from 'node:crypto';
import { parseXcBody } from './parse.js';
import { XcError, LivescopeError } from './errors.js';
import {
  parseChallenge, buildDigestHeader, buildBasicHeader, type DigestChallenge,
} from './auth.js';
import type { CameraAuth } from '../types.js';

export interface XcRequestOptions {
  timeoutMs?: number;
  retries?: number;
  auth?: CameraAuth;
  /** Override the random cnonce (tests). */
  cnonce?: string;
}

export interface XcResponse {
  map: Record<string, string>;
  livescope: number;
}

const BASE = '/-wvhttp-01-/';

function buildPath(command: string, params: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.append(k, String(v));
  const search = qs.toString();
  return `${BASE}${command}${search ? `?${search}` : ''}`;
}

export async function xcRequest(
  host: string,
  command: string,
  params: Record<string, string | number> = {},
  opts: XcRequestOptions = {},
): Promise<XcResponse> {
  const { timeoutMs = 4000, retries = 2 } = opts;
  const path = buildPath(command, params);
  const url = `http://${host}${path}`;
  let lastErr: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await once(url, path, opts, timeoutMs);
    } catch (err) {
      lastErr = err;
      if (err instanceof LivescopeError) throw err; // not retryable
      await delay(Math.min(250 * 2 ** attempt, 1000));
    }
  }
  throw new XcError(`request to ${command} failed after ${retries + 1} attempts`, lastErr);
}

async function once(
  url: string,
  path: string,
  opts: XcRequestOptions,
  timeoutMs: number,
): Promise<XcResponse> {
  let res = await fetchWithTimeout(url, {}, timeoutMs);

  if (res.status === 401 && opts.auth?.username) {
    const header = authHeaderFor(res, path, opts);
    if (header) res = await fetchWithTimeout(url, { headers: { Authorization: header } }, timeoutMs);
  }

  if (res.status !== 200) throw new XcError(`HTTP ${res.status} for ${url}`);

  const livescope = Number(res.headers.get('livescope-status') ?? '0');
  if (livescope !== 0) throw new LivescopeError(livescope, await res.text());

  const map = parseXcBody(await res.text());
  return { map, livescope };
}

function authHeaderFor(res: Response, path: string, opts: XcRequestOptions): string | null {
  const www = res.headers.get('www-authenticate') ?? '';
  const challenge: DigestChallenge | null = parseChallenge(www);
  const { username = '', password = '' } = opts.auth ?? {};
  if (challenge) {
    return buildDigestHeader({
      username, password, method: 'GET', uri: path, challenge,
      cnonce: opts.cnonce ?? randomBytes(8).toString('hex'), nc: 1,
    });
  }
  if (/^basic/i.test(www)) return buildBasicHeader(username, password);
  return null;
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test client`
Expected: PASS (5 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/xc/errors.ts packages/core/src/xc/client.ts packages/core/test/fake-camera.ts packages/core/test/client.test.ts
git commit -m "feat(core): XC HTTP client with timeout, retry, livescope and auth"
```

---

## Task 7: Control command builders

Pure functions mapping a `ControlId` + value (+ current snapshot) to the `control.cgi` parameter object. This is where the **ISO auto-switch-to-manual** decision lives. Pure = easy to test exhaustively.

**Files:**
- Create: `packages/core/src/xc/commands.ts`
- Test: `packages/core/test/commands.test.ts`

- [ ] **Step 1: Write the failing test** `packages/core/test/commands.test.ts`

```ts
import { describe, it, expect } from 'vitest';
import { buildControlParams, buildRecordParams } from '../src/xc/commands.js';

describe('buildRecordParams', () => {
  it('maps start/stop to f.rec', () => {
    expect(buildRecordParams(true)).toEqual({ 'f.rec': 'on' });
    expect(buildRecordParams(false)).toEqual({ 'f.rec': 'off' });
  });
});

describe('buildControlParams', () => {
  it('ISO forces the body into manual exposure + manual ISO', () => {
    expect(buildControlParams('iso', 800)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.isogain.mode': 'iso',
      'c.1.me.iso.mode': 'manual',
      'c.1.me.iso': '800',
    });
  });

  it('shutter sets manual exposure and a concrete speed mode', () => {
    expect(buildControlParams('shutter', 2000)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.shutter.mode': 'speed',
      'c.1.me.shutter': '2000',
    });
  });

  it('iris sets manual exposure and the abstract value', () => {
    expect(buildControlParams('iris', 200)).toEqual({
      'c.1.exp': 'manual',
      'c.1.me.iris': '200',
    });
  });

  it('wb preset sets c.1.wb directly', () => {
    expect(buildControlParams('wb', 'daylight')).toEqual({ 'c.1.wb': 'daylight' });
  });

  it('wbKelvin selects kelvin mode then the value', () => {
    expect(buildControlParams('wbKelvin', 5600)).toEqual({
      'c.1.wb': 'kelvin',
      'c.1.wb.kelvin': '5600',
    });
  });

  it('nd sets the filter value', () => {
    expect(buildControlParams('nd', 400)).toEqual({ 'c.1.nd.filter': '400' });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test commands`
Expected: FAIL — cannot find `commands.js`.

- [ ] **Step 3: Write the implementation** `packages/core/src/xc/commands.ts`

```ts
import type { ControlId } from '../types.js';

export function buildRecordParams(start: boolean): Record<string, string> {
  return { 'f.rec': start ? 'on' : 'off' };
}

/**
 * Map a control change to control.cgi params. Manual exposure controls also set
 * c.1.exp=manual so the value sticks (operator-friendly: one action = it changes).
 */
export function buildControlParams(id: ControlId, value: string | number): Record<string, string> {
  const v = String(value);
  switch (id) {
    case 'iso':
      return {
        'c.1.exp': 'manual',
        'c.1.me.isogain.mode': 'iso',
        'c.1.me.iso.mode': 'manual',
        'c.1.me.iso': v,
      };
    case 'gain':
      return {
        'c.1.exp': 'manual',
        'c.1.me.isogain.mode': 'gain',
        'c.1.me.gain.mode': 'manual',
        'c.1.me.gain': v,
      };
    case 'shutter':
      return { 'c.1.exp': 'manual', 'c.1.me.shutter.mode': 'speed', 'c.1.me.shutter': v };
    case 'iris':
      return { 'c.1.exp': 'manual', 'c.1.me.iris': v };
    case 'wb':
      return { 'c.1.wb': v };
    case 'wbKelvin':
      return { 'c.1.wb': 'kelvin', 'c.1.wb.kelvin': v };
    case 'nd':
      return { 'c.1.nd.filter': v };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test commands`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/xc/commands.ts packages/core/test/commands.test.ts
git commit -m "feat(core): control.cgi command builders with ISO auto-manual"
```

---

## Task 8: XCProtocolDriver

Ties it together: connect → snapshot → poll loop → events; record + setControl; disconnect; reconnect on poll failure. Tested against `FakeCamera`.

**Files:**
- Create: `packages/core/src/xc/driver.ts`
- Test: `packages/core/test/driver.test.ts`

- [ ] **Step 1: Write the failing test** `packages/core/test/driver.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { FakeCamera } from './fake-camera.js';
import { XCProtocolDriver } from '../src/xc/driver.js';

let cam: FakeCamera;
let drv: XCProtocolDriver;
afterEach(async () => { await drv?.disconnect(); await cam?.close(); });

const makeDriver = async (host: string) =>
  new XCProtocolDriver({ id: 'cam-1', name: 'C300', driver: 'xc', host }, { pollMs: 50 });

describe('XCProtocolDriver', () => {
  it('connects and builds state from info.cgi', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    expect(drv.status).toBe('connected');
    const s = drv.getState();
    expect(s.model).toBe('Canon EOS C300 Mark III');
    expect(s.controls.iso?.value).toBe(800);
  });

  it('starts and stops recording and updates state', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.startRecording();
    expect(drv.getState().record.recording).toBe(true);
    await drv.stopRecording();
    expect(drv.getState().record.recording).toBe(false);
  });

  it('setControl(iso) sends the manual-exposure sequence', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    await drv.setControl('iso', 1600);
    const last = cam.controlLog.at(-1)!;
    expect(last).toContain('c.1.me.iso=1600');
    expect(last).toContain('c.1.exp=manual');
    expect(drv.getState().controls.iso?.value).toBe(1600);
  });

  it('emits state when the body changes between polls', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    const onState = vi.fn();
    drv.on('state', onState);
    // simulate a body-side REC start by hitting the fake camera directly
    await fetch(`http://${host}/-wvhttp-01-/control.cgi?f.rec=on`);
    await vi.waitFor(() => expect(drv.getState().record.recording).toBe(true), { timeout: 1000 });
    expect(onState).toHaveBeenCalled();
  });

  it('goes to error status and recovers when the camera drops', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    drv = await makeDriver(host);
    await drv.connect();
    const onStatus = vi.fn();
    drv.on('status', onStatus);
    await cam.close();
    await vi.waitFor(() => expect(drv.status).toBe('error'), { timeout: 2000 });
    expect(onStatus).toHaveBeenCalledWith('error');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test driver`
Expected: FAIL — cannot find `driver.js` (the xc one).

- [ ] **Step 3: Write the implementation** `packages/core/src/xc/driver.ts`

```ts
import { EventEmitter } from 'node:events';
import type { CameraDriver } from '../driver.js';
import type {
  CameraProfile, CameraState, CameraSnapshot, ConnectionStatus, ControlId,
} from '../types.js';
import { xcRequest } from './client.js';
import { interpretInfo } from './interpret.js';
import { buildControlParams, buildRecordParams } from './commands.js';

export interface XCDriverOptions {
  pollMs?: number;
  timeoutMs?: number;
}

export class XCProtocolDriver extends EventEmitter implements CameraDriver {
  readonly id: string;
  private _status: ConnectionStatus = 'disconnected';
  private snapshot: CameraSnapshot = { record: { recording: false }, controls: {} };
  private timer?: NodeJS.Timeout;
  private polling = false;
  private lastError?: string;
  private readonly pollMs: number;
  private readonly timeoutMs: number;

  constructor(private profile: CameraProfile, opts: XCDriverOptions = {}) {
    super();
    this.id = profile.id;
    this.pollMs = opts.pollMs ?? 750;
    this.timeoutMs = opts.timeoutMs ?? 4000;
  }

  get status(): ConnectionStatus { return this._status; }

  getState(): CameraState {
    return {
      id: this.id,
      status: this._status,
      updatedAt: Date.now(),
      lastError: this.lastError,
      ...this.snapshot,
    };
  }

  async connect(): Promise<void> {
    this.setStatus('connecting');
    try {
      await this.refresh();
      this.setStatus('connected');
      this.startPolling();
    } catch (err) {
      this.fail(err);
      this.startPolling(); // keep trying to recover
      throw err;
    }
  }

  async disconnect(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    this.setStatus('disconnected');
  }

  async startRecording(): Promise<void> { await this.control(buildRecordParams(true)); }
  async stopRecording(): Promise<void> { await this.control(buildRecordParams(false)); }

  async setControl(id: ControlId, value: string | number): Promise<void> {
    await this.control(buildControlParams(id, value));
  }

  // --- internals ---

  private async control(params: Record<string, string>): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'control.cgi', params, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    // control.cgi echoes changed items; fold them in, then do a full refresh
    this.applyPartial(map);
    await this.refresh();
  }

  private async refresh(): Promise<void> {
    const { map } = await xcRequest(this.profile.host, 'info.cgi', {}, {
      auth: this.profile.auth, timeoutMs: this.timeoutMs,
    });
    this.lastError = undefined;
    this.snapshot = interpretInfo(map);
    this.emit('state', this.getState());
  }

  private applyPartial(map: Record<string, string>): void {
    // Lightweight merge so the UI feels instant before the refresh lands.
    const merged = interpretInfo(map);
    if (merged.record) this.snapshot.record = { ...this.snapshot.record, ...merged.record };
    this.snapshot.controls = { ...this.snapshot.controls, ...merged.controls };
  }

  private startPolling(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.poll(), this.pollMs);
  }

  private async poll(): Promise<void> {
    if (this.polling) return;
    this.polling = true;
    try {
      await this.refresh();
      if (this._status !== 'connected') this.setStatus('connected');
    } catch (err) {
      this.fail(err);
    } finally {
      this.polling = false;
    }
  }

  private fail(err: unknown): void {
    this.lastError = err instanceof Error ? err.message : String(err);
    this.setStatus('error');
    this.emit('error', err instanceof Error ? err : new Error(this.lastError));
  }

  private setStatus(s: ConnectionStatus): void {
    if (this._status === s) return;
    this._status = s;
    this.emit('status', s);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test driver`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/xc/driver.ts packages/core/test/driver.test.ts
git commit -m "feat(core): XCProtocolDriver with polling, events and reconnect"
```

---

## Task 9: CameraManager + profile persistence

The single command surface. Loads/saves profiles, owns drivers, re-emits driver events tagged with the camera id, routes commands.

**Files:**
- Create: `packages/core/src/manager.ts`
- Test: `packages/core/test/manager.test.ts`

- [ ] **Step 1: Write the failing test** `packages/core/test/manager.test.ts`

```ts
import { describe, it, expect, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { FakeCamera } from './fake-camera.js';
import { CameraManager } from '../src/manager.js';

let cam: FakeCamera;
let mgr: CameraManager;
afterEach(async () => { await mgr?.disconnectAll(); await cam?.close(); });

function configWith(host: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'xyst-'));
  const file = join(dir, 'cameras.json');
  writeFileSync(file, JSON.stringify({
    cameras: [{ id: 'cam-1', name: 'C300', driver: 'xc', host }],
  }));
  return file;
}

describe('CameraManager', () => {
  it('loads profiles and connects a camera', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    expect(mgr.getState('cam-1')?.status).toBe('connected');
  });

  it('routes record + setControl to the right driver', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    await mgr.connect('cam-1');
    await mgr.startRecording('cam-1');
    expect(mgr.getState('cam-1')?.record.recording).toBe(true);
    await mgr.setControl('cam-1', 'nd', 1600);
    expect(mgr.getState('cam-1')?.controls.nd?.value).toBe(1600);
  });

  it('re-emits state events tagged with camera id', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    mgr = new CameraManager(configWith(host), { pollMs: 50 });
    await mgr.load();
    const onState = vi.fn();
    mgr.on('state', onState);
    await mgr.connect('cam-1');
    expect(onState).toHaveBeenCalledWith('cam-1', expect.objectContaining({ id: 'cam-1' }));
  });

  it('adds and persists a new profile', async () => {
    cam = new FakeCamera();
    const host = await cam.listen();
    const file = configWith(host);
    mgr = new CameraManager(file, { pollMs: 50 });
    await mgr.load();
    await mgr.addCamera({ id: 'cam-2', name: 'C80', driver: 'xc', host });
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    expect(saved.cameras.map((c: any) => c.id)).toContain('cam-2');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test manager`
Expected: FAIL — cannot find `manager.js`.

- [ ] **Step 3: Write the implementation** `packages/core/src/manager.ts`

```ts
import { EventEmitter } from 'node:events';
import { readFile, writeFile } from 'node:fs/promises';
import type { CameraDriver } from './driver.js';
import type { CameraProfile, CameraState, ControlId } from './types.js';
import { XCProtocolDriver, type XCDriverOptions } from './xc/driver.js';

interface ConfigFile { cameras: CameraProfile[] }

export class CameraManager extends EventEmitter {
  private profiles = new Map<string, CameraProfile>();
  private drivers = new Map<string, CameraDriver>();

  constructor(private configPath: string, private driverOpts: XCDriverOptions = {}) {
    super();
  }

  async load(): Promise<void> {
    const raw = await readFile(this.configPath, 'utf8').catch(() => '{"cameras":[]}');
    const cfg = JSON.parse(raw) as ConfigFile;
    for (const p of cfg.cameras ?? []) {
      this.profiles.set(p.id, p);
      this.makeDriver(p);
    }
  }

  listProfiles(): CameraProfile[] { return [...this.profiles.values()]; }
  getState(id: string): CameraState | undefined { return this.drivers.get(id)?.getState(); }
  getAllStates(): CameraState[] { return [...this.drivers.values()].map((d) => d.getState()); }

  async connect(id: string): Promise<void> { await this.driver(id).connect(); }
  async connectAll(): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map((d) => d.connect()));
  }
  async disconnectAll(): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map((d) => d.disconnect()));
  }

  async startRecording(id: string): Promise<void> { await this.driver(id).startRecording(); }
  async stopRecording(id: string): Promise<void> { await this.driver(id).stopRecording(); }
  async setControl(id: string, control: ControlId, value: string | number): Promise<void> {
    await this.driver(id).setControl(control, value);
  }
  async recordAll(start: boolean): Promise<void> {
    await Promise.allSettled([...this.drivers.values()].map(
      (d) => (start ? d.startRecording() : d.stopRecording())));
  }

  async addCamera(profile: CameraProfile): Promise<void> {
    this.profiles.set(profile.id, profile);
    this.makeDriver(profile);
    await this.save();
  }

  private makeDriver(profile: CameraProfile): void {
    if (this.drivers.has(profile.id)) return;
    const driver = new XCProtocolDriver(profile, this.driverOpts); // r5c added in Phase 4
    driver.on('state', (s) => this.emit('state', profile.id, s));
    driver.on('status', (st) => this.emit('status', profile.id, st));
    driver.on('error', (e) => this.emit('camera-error', profile.id, e));
    this.drivers.set(profile.id, driver);
  }

  private driver(id: string): CameraDriver {
    const d = this.drivers.get(id);
    if (!d) throw new Error(`no camera with id ${id}`);
    return d;
  }

  private async save(): Promise<void> {
    const cfg: ConfigFile = { cameras: this.listProfiles() };
    await writeFile(this.configPath, JSON.stringify(cfg, null, 2));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test manager`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck the whole core package**

Run: `pnpm --filter @xyst/core typecheck`
Expected: no errors (now that all referenced files exist).

- [ ] **Step 6: Run the full core suite + commit**

```bash
pnpm --filter @xyst/core test
git add packages/core/src/manager.ts packages/core/test/manager.test.ts
git commit -m "feat(core): CameraManager command layer with profile persistence"
```
Expected: all core tests green.

---

## Task 10: Electron app scaffold + main process wiring

Sets up electron-vite (main/preload/renderer) and wires `CameraManager` into the main process with IPC. No camera UI yet — just prove the app boots, connects via config, and can push state to the renderer console.

**Files:**
- Create: `packages/app/package.json`, `packages/app/electron.vite.config.ts`, `packages/app/tsconfig.json`, `packages/app/tsconfig.node.json`, `packages/app/src/main/config-path.ts`, `packages/app/src/main/ipc.ts`, `packages/app/src/main/index.ts`, `packages/app/src/preload/index.ts`, `packages/app/src/preload/api.d.ts`, `packages/app/src/renderer/index.html`, `packages/app/src/renderer/main.tsx`

- [ ] **Step 1: Create `packages/app/package.json`**

```json
{
  "name": "@xyst/app",
  "version": "0.1.0",
  "type": "module",
  "main": "out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "typecheck": "tsc --noEmit -p tsconfig.node.json && tsc --noEmit -p tsconfig.json"
  },
  "dependencies": {
    "@xyst/core": "workspace:*"
  },
  "devDependencies": {
    "electron": "^31.3.0",
    "electron-vite": "^2.3.0",
    "vite": "^5.4.0",
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@types/react": "^18.3.3",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.1",
    "@radix-ui/react-slider": "^1.2.0",
    "@radix-ui/react-select": "^2.1.1"
  }
}
```

Run: `pnpm install`

- [ ] **Step 2: Create `packages/app/electron.vite.config.ts`**

```ts
import { defineConfig } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: { build: { rollupOptions: { input: resolve('src/main/index.ts') } } },
  preload: { build: { rollupOptions: { input: resolve('src/preload/index.ts') } } },
  renderer: {
    root: 'src/renderer',
    plugins: [react()],
    build: { rollupOptions: { input: resolve('src/renderer/index.html') } },
  },
});
```

- [ ] **Step 3: Create `packages/app/tsconfig.node.json` and `packages/app/tsconfig.json`**

`tsconfig.node.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "composite": true, "module": "ES2022", "types": ["node", "electron"] },
  "include": ["src/main", "src/preload", "electron.vite.config.ts"]
}
```
`tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "jsx": "react-jsx", "lib": ["ES2022", "DOM", "DOM.Iterable"], "types": ["react", "react-dom"] },
  "include": ["src/renderer", "src/preload/api.d.ts"]
}
```

- [ ] **Step 4: Create `packages/app/src/main/config-path.ts`**

```ts
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, copyFileSync } from 'node:fs';

/** cameras.json lives in userData; seed from the repo example on first run. */
export function resolveConfigPath(): string {
  const dest = join(app.getPath('userData'), 'cameras.json');
  if (!existsSync(dest)) {
    const example = join(app.getAppPath(), '..', '..', 'config', 'cameras.example.json');
    if (existsSync(example)) copyFileSync(example, dest);
  }
  return dest;
}
```

- [ ] **Step 5: Create `packages/app/src/main/ipc.ts`**

```ts
import { ipcMain, type BrowserWindow } from 'electron';
import type { CameraManager } from '@xyst/core';
import type { ControlId } from '@xyst/core';

export function registerIpc(mgr: CameraManager, getWindow: () => BrowserWindow | null): void {
  ipcMain.handle('camera:list', () => mgr.listProfiles());
  ipcMain.handle('camera:states', () => mgr.getAllStates());
  ipcMain.handle('camera:connect', (_e, id: string) => mgr.connect(id));
  ipcMain.handle('camera:record', (_e, id: string, start: boolean) =>
    start ? mgr.startRecording(id) : mgr.stopRecording(id));
  ipcMain.handle('camera:recordAll', (_e, start: boolean) => mgr.recordAll(start));
  ipcMain.handle('camera:setControl', (_e, id: string, control: ControlId, value: string | number) =>
    mgr.setControl(id, control, value));
  ipcMain.handle('camera:add', (_e, profile) => mgr.addCamera(profile));

  // push state to the renderer
  const push = (id: string, state: unknown) =>
    getWindow()?.webContents.send('camera:state', id, state);
  mgr.on('state', push);
  mgr.on('status', (id) => push(id, mgr.getState(id)));
}
```

- [ ] **Step 6: Create `packages/app/src/main/index.ts`**

```ts
import { app, BrowserWindow } from 'electron';
import { join } from 'node:path';
import { CameraManager } from '@xyst/core';
import { resolveConfigPath } from './config-path.js';
import { registerIpc } from './ipc.js';

let win: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  win = new BrowserWindow({
    width: 1100, height: 760, backgroundColor: '#0b0d10',
    webPreferences: { preload: join(import.meta.dirname, '../preload/index.js') },
  });
  if (process.env.ELECTRON_RENDERER_URL) await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  else await win.loadFile(join(import.meta.dirname, '../renderer/index.html'));
}

app.whenReady().then(async () => {
  const mgr = new CameraManager(resolveConfigPath());
  await mgr.load();
  registerIpc(mgr, () => win);
  await createWindow();
  await mgr.connectAll().catch(() => {});
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
```

- [ ] **Step 7: Create the preload** `packages/app/src/preload/index.ts`

```ts
import { contextBridge, ipcRenderer } from 'electron';

const api = {
  list: () => ipcRenderer.invoke('camera:list'),
  states: () => ipcRenderer.invoke('camera:states'),
  connect: (id: string) => ipcRenderer.invoke('camera:connect', id),
  record: (id: string, start: boolean) => ipcRenderer.invoke('camera:record', id, start),
  recordAll: (start: boolean) => ipcRenderer.invoke('camera:recordAll', start),
  setControl: (id: string, control: string, value: string | number) =>
    ipcRenderer.invoke('camera:setControl', id, control, value),
  addCamera: (profile: unknown) => ipcRenderer.invoke('camera:add', profile),
  onState: (cb: (id: string, state: unknown) => void) => {
    const h = (_e: unknown, id: string, state: unknown) => cb(id, state);
    ipcRenderer.on('camera:state', h);
    return () => ipcRenderer.off('camera:state', h);
  },
};

contextBridge.exposeInMainWorld('xyst', api);
export type XystApi = typeof api;
```

- [ ] **Step 8: Create `packages/app/src/preload/api.d.ts`**

```ts
import type { XystApi } from './index.js';
declare global {
  interface Window { xyst: XystApi }
}
export {};
```

- [ ] **Step 9: Create a minimal renderer** `packages/app/src/renderer/index.html`

```html
<!doctype html>
<html lang="en">
  <head><meta charset="utf-8" /><title>XYST CONTROL</title></head>
  <body style="margin:0;background:#0b0d10;color:#e7ecf2;font-family:system-ui">
    <div id="root"></div>
    <script type="module" src="./main.tsx"></script>
  </body>
</html>
```

`packages/app/src/renderer/main.tsx`:
```tsx
import { createRoot } from 'react-dom/client';
function Boot() {
  return <div style={{ padding: 24 }}>XYST CONTROL — booting…</div>;
}
createRoot(document.getElementById('root')!).render(<Boot />);
```

- [ ] **Step 10: Verify it boots, then commit**

Run: `pnpm --filter @xyst/app dev`
Expected: a dark Electron window shows "XYST CONTROL — booting…". Close it.

```bash
git add packages/app
git commit -m "feat(app): electron scaffold wiring CameraManager over IPC"
```

---

## Task 11: Renderer — dark theme, app shell, camera store hook

**Files:**
- Create: `packages/app/src/renderer/theme.css`, `packages/app/src/renderer/app.css`, `packages/app/src/renderer/hooks/useCameras.ts`, `packages/app/src/renderer/components/AppShell.tsx`
- Modify: `packages/app/src/renderer/main.tsx`

- [ ] **Step 1: Create the dark design tokens** `packages/app/src/renderer/theme.css`

```css
:root {
  --bg: #0b0d10;
  --surface: #14181d;
  --surface-2: #1b2127;
  --border: #2a323b;
  --text: #e7ecf2;
  --muted: #8a97a6;
  --accent: #4da3ff;
  --rec: #ff3b3b;
  --rec-glow: rgba(255, 59, 59, 0.45);
  --ok: #34d399;
  --radius: 12px;
  --shadow: 0 6px 24px rgba(0, 0, 0, 0.4);
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif; }
button { font: inherit; color: inherit; cursor: pointer; }
```

- [ ] **Step 2: Create `packages/app/src/renderer/app.css`**

```css
.app { display: flex; flex-direction: column; height: 100vh; }
.app__header { display: flex; align-items: center; justify-content: space-between;
  padding: 14px 20px; border-bottom: 1px solid var(--border); background: var(--surface); }
.app__title { font-weight: 650; letter-spacing: 0.5px; }
.app__body { padding: 20px; overflow: auto; display: grid; gap: 16px;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr)); }
.btn { background: var(--surface-2); border: 1px solid var(--border);
  border-radius: 10px; padding: 8px 14px; transition: background .15s, border-color .15s; }
.btn:hover { background: #232b33; }
.btn--ghost { background: transparent; }
```

- [ ] **Step 3: Create the store hook** `packages/app/src/renderer/hooks/useCameras.ts`

```ts
import { useEffect, useState, useCallback } from 'react';
import type { CameraState } from '@xyst/core';

export function useCameras() {
  const [states, setStates] = useState<Record<string, CameraState>>({});

  const refresh = useCallback(async () => {
    const all = (await window.xyst.states()) as CameraState[];
    setStates(Object.fromEntries(all.map((s) => [s.id, s])));
  }, []);

  useEffect(() => {
    void refresh();
    const off = window.xyst.onState((id, state) =>
      setStates((prev) => ({ ...prev, [id]: state as CameraState })));
    return off;
  }, [refresh]);

  return { states: Object.values(states), refresh };
}
```

- [ ] **Step 4: Create `packages/app/src/renderer/components/AppShell.tsx`**

```tsx
import type { ReactNode } from 'react';

export function AppShell({ children, onRecAll, onStopAll }: {
  children: ReactNode; onRecAll: () => void; onStopAll: () => void;
}) {
  return (
    <div className="app">
      <header className="app__header">
        <span className="app__title">XYST CONTROL</span>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="btn" onClick={onRecAll}>● REC ALL</button>
          <button className="btn btn--ghost" onClick={onStopAll}>■ STOP ALL</button>
        </div>
      </header>
      <main className="app__body">{children}</main>
    </div>
  );
}
```

- [ ] **Step 5: Wire `main.tsx`**

```tsx
import { createRoot } from 'react-dom/client';
import './theme.css';
import './app.css';
import { AppShell } from './components/AppShell.js';
import { CameraPanel } from './components/CameraPanel.js';
import { AddCameraForm } from './components/AddCameraForm.js';
import { useCameras } from './hooks/useCameras.js';

function App() {
  const { states, refresh } = useCameras();
  return (
    <AppShell
      onRecAll={() => window.xyst.recordAll(true)}
      onStopAll={() => window.xyst.recordAll(false)}
    >
      {states.map((s) => <CameraPanel key={s.id} state={s} />)}
      <AddCameraForm onAdded={refresh} />
    </AppShell>
  );
}
createRoot(document.getElementById('root')!).render(<App />);
```

> `CameraPanel` and `AddCameraForm` are created in Task 12; the app will not run green until then.

- [ ] **Step 6: Commit**

```bash
git add packages/app/src/renderer
git commit -m "feat(app): dark theme, app shell and camera store hook"
```

---

## Task 12: Renderer — CameraPanel, RecButton, AddCameraForm

**Files:**
- Create: `packages/app/src/renderer/components/CameraPanel.tsx`, `RecButton.tsx`, `AddCameraForm.tsx`

- [ ] **Step 1: Create `RecButton.tsx`**

```tsx
export function RecButton({ recording, onToggle }: { recording: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '10px 16px',
        borderRadius: 10, border: '1px solid var(--border)', fontWeight: 650,
        background: recording ? 'var(--rec)' : 'var(--surface-2)',
        boxShadow: recording ? '0 0 18px var(--rec-glow)' : 'none',
        color: recording ? '#fff' : 'var(--text)',
      }}
    >
      <span style={{
        width: 12, height: 12, borderRadius: '50%',
        background: recording ? '#fff' : 'var(--rec)',
      }} />
      {recording ? 'RECORDING' : 'RECORD'}
    </button>
  );
}
```

- [ ] **Step 2: Create `CameraPanel.tsx`**

```tsx
import type { CameraState } from '@xyst/core';
import { RecButton } from './RecButton.js';
import { IsoControl } from './controls/IsoControl.js';
import { ShutterControl } from './controls/ShutterControl.js';
import { IrisControl } from './controls/IrisControl.js';
import { WbControl } from './controls/WbControl.js';
import { NdControl } from './controls/NdControl.js';

const statusColor: Record<string, string> = {
  connected: 'var(--ok)', connecting: 'var(--accent)',
  error: 'var(--rec)', disconnected: 'var(--muted)',
};

export function CameraPanel({ state }: { state: CameraState }) {
  const id = state.id;
  const set = (control: string, value: string | number) =>
    window.xyst.setControl(id, control, value);
  return (
    <section style={{
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 'var(--radius)', boxShadow: 'var(--shadow)', padding: 16,
      outline: state.record.recording ? '2px solid var(--rec)' : 'none',
    }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div>
          <div style={{ fontWeight: 650 }}>{state.model ?? id}</div>
          <div style={{ fontSize: 12, color: statusColor[state.status] ?? 'var(--muted)' }}>
            {state.status}{state.lastError ? ` · ${state.lastError}` : ''}
          </div>
        </div>
        <RecButton
          recording={state.record.recording}
          onToggle={() => window.xyst.record(id, !state.record.recording)}
        />
      </header>

      <div style={{ display: 'grid', gap: 10 }}>
        {state.controls.iso?.available && <IsoControl c={state.controls.iso} onSet={(v) => set('iso', v)} />}
        {state.controls.shutter?.available && <ShutterControl c={state.controls.shutter} onSet={(v) => set('shutter', v)} />}
        {state.controls.iris?.available && <IrisControl c={state.controls.iris} onSet={(v) => set('iris', v)} />}
        {state.controls.wb?.available && (
          <WbControl
            wb={state.controls.wb} kelvin={state.controls.wbKelvin}
            onSetWb={(v) => set('wb', v)} onSetKelvin={(v) => set('wbKelvin', v)}
          />
        )}
        {state.controls.nd?.available && <NdControl c={state.controls.nd} onSet={(v) => set('nd', v)} />}
      </div>
    </section>
  );
}
```

- [ ] **Step 3: Create `AddCameraForm.tsx`**

```tsx
import { useState } from 'react';

export function AddCameraForm({ onAdded }: { onAdded: () => void }) {
  const [name, setName] = useState('C300 III');
  const [host, setHost] = useState('192.168.100.1');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    setBusy(true);
    const id = `cam-${Date.now()}`;
    await window.xyst.addCamera({ id, name, driver: 'xc', host });
    await window.xyst.connect(id);
    setBusy(false);
    onAdded();
  };

  const input: React.CSSProperties = {
    background: 'var(--surface-2)', border: '1px solid var(--border)',
    borderRadius: 8, padding: '8px 10px', color: 'var(--text)', width: '100%',
  };

  return (
    <section style={{
      background: 'var(--surface)', border: '1px dashed var(--border)',
      borderRadius: 'var(--radius)', padding: 16, display: 'grid', gap: 10, alignContent: 'start',
    }}>
      <div style={{ fontWeight: 650, color: 'var(--muted)' }}>Add camera</div>
      <input style={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="Name" />
      <input style={input} value={host} onChange={(e) => setHost(e.target.value)} placeholder="IP address" />
      <button className="btn" disabled={busy} onClick={add}>{busy ? 'Connecting…' : 'Add + Connect'}</button>
    </section>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/app/src/renderer/components
git commit -m "feat(app): camera panel, REC button and add-camera form"
```

> Controls under `components/controls/` are created in Task 13; the renderer build will fail until then. That's expected.

---

## Task 13: Renderer — capability-gated control components

Each control renders only the values the camera advertised (`c.list` / `min`/`max`). A small shared `ControlSelect` (discrete) and `ControlSlider` (range) back the specific controls.

**Files:**
- Create: `packages/app/src/renderer/components/controls/ControlSelect.tsx`, `ControlSlider.tsx`, `IsoControl.tsx`, `ShutterControl.tsx`, `IrisControl.tsx`, `WbControl.tsx`, `NdControl.tsx`

- [ ] **Step 1: Create `ControlSelect.tsx`**

```tsx
export function ControlSelect({ label, value, options, format, onChange }: {
  label: string;
  value: string | number | undefined;
  options: Array<string | number>;
  format?: (v: string | number) => string;
  onChange: (v: string | number) => void;
}) {
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '88px 1fr', alignItems: 'center', gap: 10 }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <select
        value={String(value ?? '')}
        onChange={(e) => {
          const raw = e.target.value;
          const n = Number(raw);
          onChange(raw !== '' && Number.isFinite(n) ? n : raw);
        }}
        style={{
          background: 'var(--surface-2)', color: 'var(--text)',
          border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px',
        }}
      >
        {options.map((o) => (
          <option key={String(o)} value={String(o)}>{format ? format(o) : String(o)}</option>
        ))}
      </select>
    </label>
  );
}
```

- [ ] **Step 2: Create `ControlSlider.tsx`**

```tsx
import { useState, useEffect } from 'react';

export function ControlSlider({ label, value, min, max, format, onCommit }: {
  label: string; value: number | undefined; min: number; max: number;
  format?: (v: number) => string; onCommit: (v: number) => void;
}) {
  const [local, setLocal] = useState(value ?? min);
  useEffect(() => { if (value !== undefined) setLocal(value); }, [value]);
  return (
    <label style={{ display: 'grid', gridTemplateColumns: '88px 1fr 56px', alignItems: 'center', gap: 10 }}>
      <span style={{ color: 'var(--muted)', fontSize: 13 }}>{label}</span>
      <input
        type="range" min={min} max={max} value={local}
        onChange={(e) => setLocal(Number(e.target.value))}
        onMouseUp={() => onCommit(local)}
        onTouchEnd={() => onCommit(local)}
        style={{ accentColor: 'var(--accent)' }}
      />
      <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {format ? format(local) : local}
      </span>
    </label>
  );
}
```

- [ ] **Step 3: Create the specific controls**

`IsoControl.tsx`:
```tsx
import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function IsoControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect
      label="ISO" value={c.value} options={c.list ?? []}
      format={(v) => `ISO ${v}`} onChange={(v) => onSet(Number(v))}
    />
  );
}
```

`ShutterControl.tsx`:
```tsx
import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function ShutterControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect
      label="Shutter" value={c.value} options={c.list ?? []}
      format={(v) => `1/${v}`} onChange={(v) => onSet(Number(v))}
    />
  );
}
```

`IrisControl.tsx`:
```tsx
import type { ControlState } from '@xyst/core';
import { ControlSlider } from './ControlSlider.js';

export function IrisControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSlider
      label="Iris" value={typeof c.value === 'number' ? c.value : undefined}
      min={c.min ?? 0} max={c.max ?? 100} onCommit={onSet}
    />
  );
}
```

`WbControl.tsx`:
```tsx
import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

export function WbControl({ wb, kelvin, onSetWb, onSetKelvin }: {
  wb: ControlState; kelvin?: ControlState;
  onSetWb: (v: string) => void; onSetKelvin: (v: number) => void;
}) {
  return (
    <>
      <ControlSelect label="WB" value={wb.value} options={wb.list ?? []}
        onChange={(v) => onSetWb(String(v))} />
      {wb.value === 'kelvin' && kelvin?.available && (
        <ControlSelect label="Kelvin" value={kelvin.value} options={kelvin.list ?? []}
          format={(v) => `${v}K`} onChange={(v) => onSetKelvin(Number(v))} />
      )}
    </>
  );
}
```

`NdControl.tsx`:
```tsx
import type { ControlState } from '@xyst/core';
import { ControlSelect } from './ControlSelect.js';

const ndLabel = (v: string | number) => (Number(v) === 0 ? 'Clear' : `ND ${v}`);

export function NdControl({ c, onSet }: { c: ControlState; onSet: (v: number) => void }) {
  return (
    <ControlSelect label="ND" value={c.value} options={c.list ?? []}
      format={ndLabel} onChange={(v) => onSet(Number(v))} />
  );
}
```

- [ ] **Step 4: Typecheck the app**

Run: `pnpm --filter @xyst/app typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add packages/app/src/renderer/components/controls
git commit -m "feat(app): capability-gated ISO/shutter/iris/WB/ND controls"
```

---

## Task 14: Manual verification against real cameras (Phase 1 gate)

No new code — this is the proof-of-life gate. Requires the C300 Mk III (and, when available, a C80) on the wired LAN. Get the IP from the operator.

- [ ] **Step 1: Configure the camera**

Run: `pnpm dev`, then in the app's "Add camera" panel enter the C300 III's IP and click "Add + Connect". (Or edit the `cameras.json` shown by the app under userData.)
Expected: panel shows the model name and `connected` status.

- [ ] **Step 2: Record the firmware version in `README.md`**

Fill the firmware table with the C300 III firmware (from the camera menu) and today's date. Commit:
```bash
git add README.md && git commit -m "docs: record C300 III firmware version"
```

- [ ] **Step 3: Verify record control**

Click RECORD. Expected: camera starts recording (tally on body), button turns red and reads RECORDING, panel gains a red outline. Click again → stops.

- [ ] **Step 4: Verify each exposure control**

Change ISO, shutter, WB (and Kelvin when WB=kelvin), ND, and iris (if a compatible lens is mounted). Expected: each change is reflected on the camera body and the UI value matches.

- [ ] **Step 5: Verify state sync from the body**

On the camera body, start recording and change ISO. Expected: within ~1s the app reflects both (REC state + new ISO) via polling.

- [ ] **Step 6: Verify robustness**

Unplug the camera's Ethernet. Expected: panel goes to `error` with a message; the app stays responsive. Replug. Expected: it returns to `connected` and resumes.

- [ ] **Step 7 (when a C80 is available): Repeat Steps 1–6 on the C80**

Expected: the same driver discovers the C80's controls/lists from its `info.cgi` and all of the above work. Record the C80 firmware in `README.md`. Note any control the C80 advertises differently (e.g. ISO list, no iris) — capability gating should already handle it; file follow-ups for anything that doesn't.

- [ ] **Step 8: Final commit / tag**

```bash
git add -A && git commit -m "chore: Phase 1 proof-of-life verified on C300 III"
git tag phase-1
```

---

## Self-review notes (author)

- **Spec coverage:** connect/session (sessionless — Task 8), record start/stop + state (Tasks 7/8/12), ISO with auto-manual (Tasks 7/8/13), shutter/iris/WB/ND (Tasks 4/7/13), capability discovery (Task 4 gating + Task 13 rendering), manual IP + saved profiles (Tasks 9/12), timeouts/retries/never-lock-up + reconnect (Tasks 6/8), modern dark UI (Tasks 11–13), C80 via same driver (Task 14 step 7). REST API, presets, event-stream sync, live view, touch focus, Companion are correctly **out of Phase 1** (Phases 2–7).
- **Type consistency:** `ControlState`, `CameraState`, `CameraSnapshot`, `CameraProfile`, `ControlId` are defined once in `types.ts` and used unchanged in driver, manager, IPC, and renderer. `buildControlParams`/`buildRecordParams` signatures match their callers in `driver.ts`. The preload `XystApi` matches `useCameras`/`CameraPanel` call sites.
- **Known Phase-1 simplifications (intended):** state sync is polling (event-stream is Phase 2); `control.cgi` does a full `info.cgi` refresh afterward rather than trusting the partial echo (correctness over chattiness — fine at Phase 1 cadence); shutter always uses `mode=speed` on set (angle/slow/clearscan modes are a Phase 2 refinement).
```

