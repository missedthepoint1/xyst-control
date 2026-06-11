# XYST CONTROL — Bitfocus Companion module

Drive XYST CONTROL from a Stream Deck via [Bitfocus Companion](https://bitfocus.io/companion).
This module is a **pure REST/SSE client** of the app's local API (`@xyst/core`) — it never
talks to a camera directly, so the app stays the single source of truth.

## Build

```bash
pnpm --filter @xyst/companion-module build
```

Produces `dist/index.js` (dev entry, referenced by `companion/manifest.json`) and a
packaged `pkg/` + `pkg.tgz`.

## Load into Companion

1. **Run the XYST CONTROL app** — it serves the API on `http://127.0.0.1:8088`.
2. In Companion → **Settings → Developer modules path**, point it at this repo's
   `packages` folder (Companion scans sub-folders for `companion/manifest.json`; it'll
   find `companion-module` and ignore the rest). Restart Companion if it doesn't appear.
3. Companion → **Connections → Add connection** → search **XYST** (`xyst-control`).
4. Set **host** = `127.0.0.1` and **port** = `8088` (the app's API). For a Stream Deck on
   a *different* machine, use the app machine's LAN IP and make sure port 8088 is reachable.

Camera, preset and focus-point dropdowns populate from the app at connect time and update
live over SSE (`/api/events`). If you add a camera in the app, hit the connection's
**reload** in Companion to refresh the lists.

## What it exposes

**Actions**
- Record: start / stop / toggle (per camera) and **Record ALL** start/stop
- **Set control (any, by value)** — every control id, value supports variables
- **Step control up/down** — ISO, gain, shutter, shutter-angle, iris, Kelvin, ND, WB CC,
  AF speed/response (list/range-aware stepping lives in the app core)
- Mode toggles: **Focus AF/MF**, **Face detection** (off/face/track), **Shutter mode**,
  **Color bars**, **AWB hold**, **Focus action** (one-shot AF / near / far / stop),
  **Set WB A/B**, **Camera OSD output** (SDI/HDMI burn-in on/off)
- Presets: **Recall preset** (dropdown across cameras), recall by id/variable, **Save preset**
- Focus: **Recall focus point** (rack focus, dropdown), **Pull focus to X/Y** (0..1)

**Feedbacks** (button styling)
- **Recording tally** (per camera) and **Any camera recording**
- **Connected** (per camera)
- **Control equals value** — highlight active modes (e.g. button glows when Focus = MF)

**Variables** (per camera, live)
- `name`, `status`, `model`, `recording`, `exposure`, `battery`, `remaining`
- control values: ISO, gain, shutter, shutter-angle, iris, WB, Kelvin, ND, focus,
  face detect, color bars, ISO-auto, ND-adv, WB CC, AWB hold, AF mode/speed/response/lock,
  camera OSD

## Notes

- The module's port/host default to the app's loopback API; the app must be running first.
- No auth (loopback tool); don't expose port 8088 to untrusted networks.
