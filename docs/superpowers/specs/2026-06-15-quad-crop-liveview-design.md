# Quad-crop live view from a shared 4K capture device

**Date:** 2026-06-15
**Phase:** 5 (live view multiview)
**Status:** Design approved, ready for implementation plan

## Problem

The app consumes video via `getUserMedia`/UVC. Today a `capture` video source
(`VideoPanel.tsx`) opens `getUserMedia({ deviceId: { exact } })` and shows the
**whole** device frame in one panel. That works for one camera per device, but
the Phase 5 multiview chain feeds **four cameras through one UVC device**:

```
ATEM 2 M/E Constellation 4K  →  2160p multiview, clean 2×2 grid (no labels/meters/borders)
        │ 12G-SDI
        ▼
Blackmagic Web Presenter 4K  →  4K (2160p) USB-C webcam out
        │
        ▼
Mac sees ONE UVC device at 2160p, carrying a 2×2 grid of four cameras.
```

The app must crop that one 4K device into four real 1080p quadrants, map each
quadrant to a `cameraId`, and convert a tap in a quadrant to that camera's
normalized 0..1 focus coordinates.

This is the gap. Single-device full-frame capture already works; the missing
layer is **cropping/mapping one shared device into per-camera quadrants**.

See also the saved Phase 5 plan (gear chain, why the Web Presenter is required:
the ATEM's own USB out caps at 1080p, only the Web Presenter 4K delivers a true
2160p UVC stream, only genuine 2160p yields four real 1080p tiles).

## Scope

**In scope (now):**
- A `quad` video source: one shared 4K UVC device, cropped into a fixed **2×2**
  grid, each quadrant assigned to a camera.
- A shared, ref-counted capture-stream registry so one physical device is opened
  once and shared across the four panels (a UVC device is single-consumer).
- Quadrant-aware focus tap → normalized 0..1 within the quadrant.
- Source-selector UI to assign a camera to a device + quadrant (or full frame).
- Gate against the live Web Presenter 4K chain.

**Out of scope (explicit):**
- Configurable grid sizes (3×3, etc.) — fixed 2×2 only. Generalize later if ever.
- A global "quad config" object — assignment stays per-camera on the existing
  `VideoSource`.
- A native multi-input capture path (DeckLink-style SDK sidecar). Not designed
  now; the abstraction is kept open so it can plug in later as a new source type
  with no disruption to this work.
- Per-tile LUT / view-assist on capture sources (only protocol/JPEG has view
  assist today; unchanged here).

## Approaches considered

1. **CSS-crop + shared ref-counted stream registry — CHOSEN.** Open each device
   once, share the `MediaStream` across panels, each panel shows its quadrant via
   a GPU-composited CSS crop. Zero per-frame JS, lowest latency, trivial focus
   math.
2. **Canvas-crop.** One hidden `<video>`, each tile `drawImage`s its quadrant on a
   rAF loop. Enables per-tile pixel overlays/LUT later, but 4×4K `drawImage` every
   frame is real CPU for no current benefit. Rejected for now; the registry keeps
   this door open if pixel-level per-tile processing is ever needed.
3. **Per-panel `getUserMedia` (today's code).** Fails for quad: a UVC capture
   device is single-consumer, so four panels cannot each open the same device.
   Rejected — this is the limitation the registry fixes.

## Design

### 1. Data model (`@xyst/core` `types.ts`)

Extend `VideoSource`:

```ts
export interface VideoSource {
  type: 'none' | 'protocol' | 'capture' | 'quad';
  deviceId?: string;
  quadrant?: 0 | 1 | 2 | 3; // 0=TL 1=TR 2=BL 3=BR; only meaningful for type:'quad'
}
```

- Per-camera, persisted in `cameras.json` exactly as today (the field already
  exists on the profile). Core stays opaque: it stores and echoes `video`; the
  renderer interprets it. Adding a `type` value is low-risk.
- Four cameras independently set
  `{ type: 'quad', deviceId: <WebPresenter>, quadrant: 0..3 }`. There is no global
  constraint — a fifth camera could be full-frame `capture` on another device at
  the same time. Assignment is entirely per-camera.

### 2. Shared stream registry (new `renderer/captureStreams.ts`)

A ref-counted store keyed by `deviceId`, plus a `useCaptureStream(deviceId)` hook
returning `{ stream, status }` where status ∈ `'idle' | 'opening' | 'live' |
'error'`.

- First consumer of a `deviceId` calls
  `getUserMedia({ deviceId: { exact: deviceId }, width: { ideal: 3840 },
  height: { ideal: 2160 } })`. The `ideal` 4K hint matters: without it the device
  may default to 720p and quadrants become 640×360.
- All consumers of the same `deviceId` receive the **same** `MediaStream`. One
  stream can back multiple `<video>` elements; each plays independently.
- Ref-count consumers; when the last one unmounts, stop the tracks and evict.
- On `getUserMedia` failure, status `'error'` (panels show "No signal"); retry on
  the next mount.
- Log the actual resolved track resolution (`track.getSettings()`) once per open,
  so we can confirm we really negotiated 2160p (the Web Presenter USB caveat).

**Both `capture` and `quad` route through this registry.** Full-frame `capture`
becomes "quad with no crop." This unifies the two paths and removes today's
per-panel `getUserMedia` (which prevents two panels from sharing a device).

### 3. Rendering & crop (`VideoPanel.tsx`)

For `capture` and `quad` sources:

- Subscribe via `useCaptureStream(source.deviceId)`; attach the shared stream to a
  `<video autoPlay muted playsInline>` inside an `overflow:hidden` wrapper.
- **Full frame** (`capture`): the video fills the wrapper as today.
- **Quadrant** (`quad`): the video is scaled to 200% width/height and translated by
  the quadrant's row/col so that quadrant fills the panel:
  - col = `quadrant % 2`, row = `Math.floor(quadrant / 2)`
  - `width:200%; height:200%; left: -(col*100)%; top: -(row*100)%` (or an
    equivalent transform).
- Each 4K quadrant is 1920×1080 (16:9), so it fills a 16:9 panel with no
  letterbox. The crop is GPU-composited; no per-frame JavaScript.
- Replace the current per-panel `getUserMedia` effect (`VideoPanel.tsx:64`) with
  the registry subscription; preserve the existing error/"No signal" placeholder
  behavior driven by the hook's status.

### 4. Focus remap (`VideoPanel.tsx` `tap`)

Because the crop wrapper **is** the quadrant (aspect-ratio matched, no letterbox),
quad tap coordinates are wrapper-relative directly:

```
nx = (clientX - rect.left) / rect.width
ny = (clientY - rect.top)  / rect.height
```

These are already the camera's normalized 0..1. The existing full-frame
letterbox math (which reads `naturalWidth`/`videoWidth` and centers the active
image) stays for `protocol` and full-frame `capture` sources. The tap handler
branches on `source.type === 'quad'`.

### 5. UI selector (`VideoSourceSelect.tsx`)

Per detected capture device, render an `<optgroup label="<device name>">` with:

- **Full frame** → `{ type: 'capture', deviceId }`
- **◤ Top-left** → `{ type: 'quad', deviceId, quadrant: 0 }`
- **◥ Top-right** → `{ type: 'quad', deviceId, quadrant: 1 }`
- **◣ Bottom-left** → `{ type: 'quad', deviceId, quadrant: 2 }`
- **◢ Bottom-right** → `{ type: 'quad', deviceId, quadrant: 3 }`

The existing `none` / `protocol` options remain. The built-in webcam stays
filtered out. The `current`→value mapping handles `quad` (device + quadrant).

## Error handling

- Device open failure → hook status `'error'` → panel shows "No signal"
  placeholder; control and the REST API are unaffected (architecture rule 5:
  video is decoupled from control). Retry on next mount.
- A quadrant whose ATEM source has no signal simply shows black within the grid —
  no special handling; it is the camera's responsibility upstream.
- Registry eviction race (last unmount then immediate remount) must not leave a
  dangling stopped stream; the hook re-opens cleanly.

## Testing / gate (live Web Presenter 4K chain available)

Manual gate against the real chain:

1. In **Multiview**, the four tiles reassemble the ATEM 2×2 correctly and each
   panel shows the camera the operator expects (quadrant→camera mapping correct).
2. A tap in a tile racks focus on the **correct** body at the right point
   (focus-coord remap correct per quadrant).
3. The shared device is opened **once** — no "device busy"/second-open failure
   with all four quadrants live.
4. Logged track resolution confirms **2160p** capture (so quadrants are true
   1080p, not 540p).
5. Dropping the preview (unplug USB) does not affect control or the REST API
   (rule 5), and reconnecting recovers.

A non-4K stand-in (e.g. any single webcam set to one quadrant) can sanity-check
layout and focus math, but the gate is the real chain.

## Files touched

- `packages/core/src/types.ts` — extend `VideoSource`.
- `packages/app/src/renderer/captureStreams.ts` — **new** ref-counted registry +
  `useCaptureStream` hook.
- `packages/app/src/renderer/components/VideoPanel.tsx` — registry subscription,
  crop rendering, quad focus remap.
- `packages/app/src/renderer/components/VideoSourceSelect.tsx` — quadrant options.
- Styles for the crop wrapper (wherever `.video__img` styles live).
