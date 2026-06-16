# Quad-crop Live View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Crop one shared 4K UVC capture device (Blackmagic Web Presenter 4K carrying an ATEM 2×2 multiview) into four 1080p quadrants, each mapped to a camera, with quadrant-aware touch focus.

**Architecture:** Add a `quad` `VideoSource` (deviceId + quadrant 0–3). A ref-counted renderer registry opens each physical device exactly once and shares its `MediaStream` across panels (a UVC device is single-consumer). Each panel shows its quadrant via a GPU-composited CSS crop (`<video>` scaled 200% and translated). A tap in a quadrant maps directly to that camera's normalized 0..1 focus coordinates.

**Tech Stack:** TypeScript, React (Electron renderer), `getUserMedia`/UVC, vitest (core package only — the app package has no test runner, so renderer wiring is verified by typecheck + the live hardware gate).

---

## File structure

- `packages/core/src/types.ts` — extend `VideoSource` (add `'quad'` + `quadrant`).
- `packages/core/src/video.ts` — **new** pure helper `quadrantPosition(q)` → `{col,row}`. The error-prone 0=TL…3=BR mapping; unit-tested.
- `packages/core/src/index.ts` — export the helper.
- `packages/core/test/video.test.ts` — **new** vitest for `quadrantPosition`.
- `packages/app/src/renderer/captureStreams.ts` — **new** ref-counted shared-stream registry + `useCaptureStream` hook.
- `packages/app/src/renderer/components/VideoPanel.tsx` — route `capture`/`quad` through the registry; quad crop rendering; quad focus remap.
- `packages/app/src/renderer/components/VideoSourceSelect.tsx` — per-device quadrant `<optgroup>`.
- `packages/app/src/renderer/app.css` — `.video__img--quad` crop rule.

---

## Task 1: Core — `VideoSource` type + `quadrantPosition` helper

**Files:**
- Modify: `packages/core/src/types.ts:89`
- Create: `packages/core/src/video.ts`
- Modify: `packages/core/src/index.ts`
- Test: `packages/core/test/video.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/test/video.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { quadrantPosition } from '../src/video.js';

describe('quadrantPosition', () => {
  it('maps quadrant indices to grid positions in reading order', () => {
    expect(quadrantPosition(0)).toEqual({ col: 0, row: 0 }); // top-left
    expect(quadrantPosition(1)).toEqual({ col: 1, row: 0 }); // top-right
    expect(quadrantPosition(2)).toEqual({ col: 0, row: 1 }); // bottom-left
    expect(quadrantPosition(3)).toEqual({ col: 1, row: 1 }); // bottom-right
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @xyst/core test -- video`
Expected: FAIL — cannot resolve `../src/video.js` / `quadrantPosition is not a function`.

- [ ] **Step 3: Create the helper**

Create `packages/core/src/video.ts`:

```ts
/** A camera's slot in a 2×2 capture grid. 0=TL 1=TR 2=BL 3=BR (reading order). */
export type Quadrant = 0 | 1 | 2 | 3;

/** Grid position of a quadrant: col/row are each 0 or 1. Pure; used for CSS crop offsets. */
export function quadrantPosition(q: Quadrant): { col: 0 | 1; row: 0 | 1 } {
  return { col: (q % 2) as 0 | 1, row: (Math.floor(q / 2)) as 0 | 1 };
}
```

- [ ] **Step 4: Extend `VideoSource`**

In `packages/core/src/types.ts`, replace line 89:

```ts
export interface VideoSource { type: 'none' | 'protocol' | 'capture'; deviceId?: string; }
```

with:

```ts
export interface VideoSource {
  type: 'none' | 'protocol' | 'capture' | 'quad';
  deviceId?: string;
  quadrant?: import('./video.js').Quadrant; // 0=TL 1=TR 2=BL 3=BR; only for type:'quad'
}
```

- [ ] **Step 5: Export the helper**

In `packages/core/src/index.ts`, add after the `export * from './types.js';` line:

```ts
export * from './video.js';
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm --filter @xyst/core test -- video`
Expected: PASS (1 test).

- [ ] **Step 7: Typecheck core**

Run: `pnpm --filter @xyst/core typecheck`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/video.ts packages/core/src/index.ts packages/core/test/video.test.ts
git commit -m "feat(core): quad VideoSource + quadrantPosition helper"
```

---

## Task 2: Renderer — shared capture-stream registry

A single UVC device is single-consumer, so all four quad panels must share one `getUserMedia` call. This registry opens each `deviceId` once, ref-counts consumers, and shares the `MediaStream`. It also replaces today's per-panel `getUserMedia` for full-frame `capture`, so two panels can finally share one device.

**Files:**
- Create: `packages/app/src/renderer/captureStreams.ts`

- [ ] **Step 1: Create the registry + hook**

Create `packages/app/src/renderer/captureStreams.ts`:

```ts
import { useEffect, useState } from 'react';

export type CaptureStatus = 'idle' | 'opening' | 'live' | 'error';
type Snapshot = { stream: MediaStream | null; status: CaptureStatus };
type Listener = (s: Snapshot) => void;

interface Entry {
  stream: MediaStream | null;
  status: CaptureStatus;
  refs: number;
  listeners: Set<Listener>;
}

const registry = new Map<string, Entry>();

function emit(entry: Entry): void {
  const snap: Snapshot = { stream: entry.stream, status: entry.status };
  entry.listeners.forEach((l) => l(snap));
}

async function open(deviceId: string, entry: Entry): Promise<void> {
  entry.status = 'opening';
  emit(entry);
  try {
    // Request 4K explicitly — without the ideal hint the device may negotiate 720p,
    // which would make each quadrant 640×360 instead of a true 1080p.
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { deviceId: { exact: deviceId }, width: { ideal: 3840 }, height: { ideal: 2160 } },
    });
    // Everyone left while we were awaiting — discard so we don't leak an open device.
    if (entry.refs === 0) { stream.getTracks().forEach((t) => t.stop()); entry.status = 'idle'; return; }
    entry.stream = stream;
    entry.status = 'live';
    const s = stream.getVideoTracks()[0]?.getSettings();
    console.info(`[capture] ${deviceId} opened at ${s?.width}×${s?.height}@${s?.frameRate ?? '?'}fps`);
    emit(entry);
  } catch (err) {
    entry.status = 'error';
    console.warn(`[capture] ${deviceId} failed to open`, err);
    emit(entry);
  }
}

function acquire(deviceId: string, listener: Listener): () => void {
  let entry = registry.get(deviceId);
  if (!entry) {
    entry = { stream: null, status: 'idle', refs: 0, listeners: new Set() };
    registry.set(deviceId, entry);
  }
  const e = entry;
  e.listeners.add(listener);
  e.refs += 1;
  if (e.status === 'idle') void open(deviceId, e);
  else listener({ stream: e.stream, status: e.status });
  return () => {
    e.listeners.delete(listener);
    e.refs -= 1;
    if (e.refs === 0) {
      e.stream?.getTracks().forEach((t) => t.stop());
      registry.delete(deviceId);
    }
  };
}

/** Subscribe to a shared capture device. Opens it once; all callers share the stream. */
export function useCaptureStream(deviceId?: string): Snapshot {
  const [snap, setSnap] = useState<Snapshot>({ stream: null, status: 'idle' });
  useEffect(() => {
    if (!deviceId) { setSnap({ stream: null, status: 'idle' }); return; }
    return acquire(deviceId, setSnap);
  }, [deviceId]);
  return snap;
}
```

- [ ] **Step 2: Typecheck the app**

Run: `pnpm --filter @xyst/app typecheck`
Expected: no errors (file is unused so far, but must compile).

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/captureStreams.ts
git commit -m "feat(app): ref-counted shared capture-stream registry"
```

---

## Task 3: Renderer — VideoPanel quad crop, shared stream, focus remap

Replace the per-panel `getUserMedia` (`VideoPanel.tsx:64-71`) with the registry, render the quad crop, and remap quad focus taps.

**Files:**
- Modify: `packages/app/src/renderer/components/VideoPanel.tsx`
- Modify: `packages/app/src/renderer/app.css`

- [ ] **Step 1: Import the registry, helper, and quadrant geometry**

At the top of `VideoPanel.tsx`, update the imports:

```ts
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { VideoSource } from '@xyst/core';
import { quadrantPosition } from '@xyst/core';
import { applyViewAssist, type ResolvedViewAssist } from '../viewAssist.js';
import { useCaptureStream } from '../captureStreams.js';
```

Then add this module-level helper just below the imports (above the type aliases):

```ts
/** CSS to show only one quadrant of a 4K frame: scale 200% and translate the chosen cell into view. */
function quadStyle(q: 0 | 1 | 2 | 3): CSSProperties {
  const { col, row } = quadrantPosition(q);
  return { position: 'absolute', width: '200%', height: '200%', maxWidth: 'none',
    left: `${-col * 100}%`, top: `${-row * 100}%`, objectFit: 'contain' };
}
```

- [ ] **Step 2: Replace the capture `getUserMedia` effect with the shared hook**

Delete this effect (`VideoPanel.tsx:64-71`):

```ts
  useEffect(() => {
    if (type !== 'capture' || !source?.deviceId) return;
    let cancelled = false; let stream: MediaStream | undefined;
    navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: source.deviceId } } })
      .then((s) => { if (cancelled) { s.getTracks().forEach((t) => t.stop()); return; } stream = s; if (videoRef.current) videoRef.current.srcObject = s; setErr(false); })
      .catch(() => setErr(true));
    return () => { cancelled = true; stream?.getTracks().forEach((t) => t.stop()); };
  }, [type, source?.deviceId]);
```

Replace it with the shared-stream subscription + attach effect:

```ts
  const isDeviceSource = type === 'capture' || type === 'quad';
  const capture = useCaptureStream(isDeviceSource ? source?.deviceId : undefined);
  useEffect(() => {
    const v = videoRef.current;
    if (v) v.srcObject = capture.stream;
  }, [capture.stream]);
  const captureErr = isDeviceSource && capture.status === 'error';
```

- [ ] **Step 3: Branch the focus tap for quad sources**

In the `tap` handler, immediately after the `if (onSelect) { onSelect(); return; }` line, insert the quad branch:

```ts
    if (source?.type === 'quad') {
      // The visible panel IS the quadrant (aspect-matched, no letterbox) — tap coords are
      // already the camera's normalized 0..1.
      const rect = e.currentTarget.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width;
      const ny = (e.clientY - rect.top) / rect.height;
      if (nx < 0 || ny < 0 || nx > 1 || ny > 1) return;
      void window.xyst.setFocusPoint(cameraId, nx, ny);
      onFocus?.(nx, ny);
      setMark({ x: nx * 100, y: ny * 100 });
      setTimeout(() => setMark(null), 1500);
      return;
    }
```

(The existing letterbox math below stays for `protocol` and full-frame `capture`.)

- [ ] **Step 4: Render the quad video element + fold quad into error/placeholder logic**

Replace the capture render line (`VideoPanel.tsx:108`):

```tsx
      {type === 'capture' && <video ref={videoRef} className="video__img" autoPlay muted playsInline />}
```

with both capture and quad variants:

```tsx
      {type === 'capture' && <video ref={videoRef} className="video__img" autoPlay muted playsInline />}
      {type === 'quad' && (
        <video ref={videoRef} className="video__img video__img--quad"
          style={quadStyle(source?.quadrant ?? 0)} autoPlay muted playsInline />
      )}
```

Then update the placeholder condition (`VideoPanel.tsx:109`) so a failed device shows "No signal":

```tsx
      {(type === 'none' || err) && (
```

becomes:

```tsx
      {(type === 'none' || err || captureErr) && (
```

And the placeholder's inner text/icon test (`VideoPanel.tsx:111` and `:122`) currently uses `type === 'none'`. Those stay correct: `none` → "No video source"; any device error → the "No signal" branch. No change needed there beyond the condition above.

- [ ] **Step 5: Add the crop CSS rule**

In `packages/app/src/renderer/app.css`, immediately after the `.video__img` rule (line 262), add:

```css
.video__img--quad { position: absolute; max-width: none; }
```

(The 200% size and offsets are applied inline by `quadStyle`; `.video` already has `overflow: hidden`, so the scaled video is clipped to the panel.)

- [ ] **Step 6: Typecheck the app**

Run: `pnpm --filter @xyst/app typecheck`
Expected: no errors.

- [ ] **Step 7: Build the renderer to confirm it compiles end-to-end**

Run: `pnpm --filter @xyst/app build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add packages/app/src/renderer/components/VideoPanel.tsx packages/app/src/renderer/app.css
git commit -m "feat(app): quad-crop live view via shared capture stream + quad focus remap"
```

---

## Task 4: Renderer — VideoSourceSelect quadrant options

Add a per-device `<optgroup>` offering Full frame + the four quadrants.

**Files:**
- Modify: `packages/app/src/renderer/components/VideoSourceSelect.tsx`

- [ ] **Step 1: Encode/decode quad values and render optgroups**

Replace the entire body of `VideoSourceSelect.tsx` (keep the imports) with:

```tsx
import { useEffect, useState } from 'react';
import type { VideoSource } from '@xyst/core';

const QUADS: { q: 0 | 1 | 2 | 3; label: string }[] = [
  { q: 0, label: '◤ Top-left' },
  { q: 1, label: '◥ Top-right' },
  { q: 2, label: '◣ Bottom-left' },
  { q: 3, label: '◢ Bottom-right' },
];

export function VideoSourceSelect({ current, onChange, name }: {
  current?: VideoSource; onChange: (v: VideoSource) => void; name?: string;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  useEffect(() => {
    // Only real SDI/HDMI capture cards are valid sources — drop the Mac's built-in
    // webcam, which is never a production feed.
    const isBuiltInWebcam = (label: string) => /(macbook|facetime|built[- ]?in)/i.test(label);
    navigator.mediaDevices?.enumerateDevices?.()
      .then((ds) => setDevices(ds.filter((d) => d.kind === 'videoinput' && !isBuiltInWebcam(d.label))))
      .catch(() => {});
  }, []);

  // Serialize the current source to the <select> value.
  let value = 'none';
  if (current?.type === 'protocol') value = 'protocol';
  else if (current?.type === 'capture') value = `capture:${current.deviceId ?? ''}`;
  else if (current?.type === 'quad') value = `quad:${current.deviceId ?? ''}:${current.quadrant ?? 0}`;

  return (
    <select className="select video__src" value={value} onChange={(e) => {
      const v = e.target.value;
      if (v === 'protocol') onChange({ type: 'protocol' });
      else if (v.startsWith('capture:')) onChange({ type: 'capture', deviceId: v.slice('capture:'.length) });
      else if (v.startsWith('quad:')) {
        const [, deviceId, q] = v.split(':');
        onChange({ type: 'quad', deviceId, quadrant: Number(q) as 0 | 1 | 2 | 3 });
      } else onChange({ type: 'none' });
    }}>
      <option value="none">No video</option>
      <option value="protocol">{name ? `${name} — Live view` : 'Live view'}</option>
      {devices.map((d, i) => (
        <optgroup key={d.deviceId} label={d.label || `Capture device ${i + 1}`}>
          <option value={`capture:${d.deviceId}`}>Full frame (SDI/HDMI · high-res)</option>
          {QUADS.map(({ q, label }) => (
            <option key={q} value={`quad:${d.deviceId}:${q}`}>{label} (quad)</option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}
```

- [ ] **Step 2: Typecheck the app**

Run: `pnpm --filter @xyst/app typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/app/src/renderer/components/VideoSourceSelect.tsx
git commit -m "feat(app): quadrant options in the video source selector"
```

---

## Task 5: Hardware gate — verify against the live Web Presenter 4K chain

No code; this is the Phase 5 capture gate against real gear (ATEM 2×2 → Web Presenter 4K → 4K UVC). Configure the ATEM multiview as a clean 2×2 (labels/meters/borders OFF) before testing.

**Files:** none.

- [ ] **Step 1: Launch the app**

Run: `pnpm dev`
Expected: app window opens.

- [ ] **Step 2: Assign quadrants**

For each of the four cameras, open its video source selector and pick the Web Presenter device → the matching quadrant (◤/◥/◣/◢). Save.

- [ ] **Step 2 check:** Each camera panel shows the correct camera, and the four together reassemble the ATEM 2×2 with no quadrant bleed (no labels/meters in-frame).

- [ ] **Step 3: Confirm single device open**

Open the renderer devtools console.
Expected: exactly **one** `[capture] … opened at 3840×2160@…fps` line for the device (not four), and no `failed to open` / "device busy" errors with all four quadrants live.

- [ ] **Step 4: Confirm true 4K**

In the same log line, verify the resolution is `3840×2160` (so each quadrant is a real 1080p, not 540p). Note the frame rate (the Web Presenter USB caveat) in the gate notes.

- [ ] **Step 5: Focus tap accuracy**

Tap a subject in each quadrant.
Expected: the **correct** body racks focus to the **tapped point** (quadrant→camera mapping and focus remap both correct).

- [ ] **Step 6: Decouple-from-control check (architecture rule 5)**

Unplug the Web Presenter USB while a camera is recording.
Expected: panels show "No signal", but record state, control, and the REST API keep working. Replug → preview recovers.

- [ ] **Step 7: Record the gate result**

Note pass/fail + the observed capture resolution and frame rate in the PR description (and update the Phase 5 memory if the chain behaves differently than planned).

---

## Self-review notes

- **Spec coverage:** data model (Task 1), shared registry (Task 2), crop render + focus remap (Task 3), selector UI (Task 4), error handling (Task 2 status + Task 3 `captureErr`/placeholder + Task 5 Step 6), live gate (Task 5). All spec sections map to a task.
- **Type consistency:** `quadrantPosition`, `Quadrant`, `VideoSource.quadrant`, `useCaptureStream`, `CaptureStatus`, `quadStyle` are defined once and used with matching signatures across tasks.
- **No placeholders:** every code step shows complete code; every run step states the expected result.
- **Test reality:** only `core` has a test runner, so only the pure `quadrantPosition` mapping is unit-tested; renderer wiring is gated by typecheck, build, and the live hardware checklist (the real Phase 5 proof per the spec).
