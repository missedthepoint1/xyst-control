# Release-Readiness: Auto-Updater + Security/Packaging Hardening — Design

**Date:** 2026-06-17
**Status:** Approved design, pending implementation plan
**Scope:** Make XYST CONTROL ready for production direct distribution (Developer ID + notarized; **not** Mac App Store — see memory `no-mac-app-store`). Bundles a new auto-updater with the highest-priority findings from the release-readiness audit.

## Goals

1. Ship an in-app auto-updater appropriate for live-production use (never interrupts a show).
2. Close the one true release-blocker: the local REST API is reachable/writable by any webpage the operator visits (DNS-rebinding / CSRF).
3. Harden the Electron shell (navigation lockdown, scoped media permission, CSP).
4. Fix release hygiene: version drift and an un-codified notarize/staple step.
5. Add a top-level crash guard so a stray throw can't kill the app mid-show.

## Non-goals (explicit YAGNI / deferred follow-ups)

- Mac App Store packaging (ruled out).
- Windows code-signing (Windows auto-update will function but stay unsigned for now → SmartScreen friction; harden later).
- Linux auto-update (AppImage target stays as-is, no updater).
- macOS Keychain (`safeStorage`) for camera credentials (audit L2 — optional follow-up).
- Removing the broad `disable-library-validation` entitlement (audit M2 — optional, kept for the future Sony sidecar).
- Crash-reporter / telemetry (the app intentionally sends nothing off-machine).

---

## Part A — Auto-updater

### Behavior

Check on launch + every 6 hours → silently download in the background → on `update-downloaded`, surface a non-intrusive banner with three actions:

- **Install & Restart** → `autoUpdater.quitAndInstall()`.
- **Skip this version** → persist the version to a skip store; never prompt for it again.
- **Later** → dismiss for this session only (re-appears next launch if still applicable).

Nothing restarts on its own. `autoDownload = true`, `autoInstallOnAppQuit = false` — even a normal quit will not swap the binary; only an explicit "Install & Restart" installs. This is the safest posture for event software.

### Components

1. **Build config** (`packages/app/electron-builder.yml`)
   - Add `zip` to `mac.target` (electron-updater requires a `.zip` on macOS; the `dmg` stays as the human download). Keep `nsis` for Windows.
   - Add a `publish:` block: `provider: github`, the repo owner/name. This makes electron-builder emit `latest-mac.yml` / `latest.yml` — the feed files the updater reads.

2. **`packages/app/src/main/updater.ts`** (new)
   - Wraps `autoUpdater` from `electron-updater`. Sets `autoDownload = true`, `autoInstallOnAppQuit = false`.
   - Guarded by `app.isPackaged` — dev runs never check or download.
   - Runs `checkForUpdates()` on launch and on a 6h interval.
   - Subscribes to lifecycle events (`checking-for-update`, `update-available`, `download-progress`, `update-downloaded`, `error`) and pushes a single `UpdateStatus` object to the renderer via IPC.
   - On `update-available`, consults the skip store; if the offered version equals `skippedVersion`, stays silent (no download notification surfaced).

3. **Skip-version store**
   - A tiny JSON file in `userData` holding `{ skippedVersion: string }` (mirrors the existing config-store pattern in `core/manager.ts`; no new dependency).

4. **Preload + IPC**
   - Extend the existing typed `contextBridge` surface only:
     - main→renderer push: `update:status` (an `UpdateStatus`).
     - renderer→main: `update:install`, `update:skip`, `update:dismiss`.
   - No widening of the security model — same narrow, typed bridge.

5. **Renderer UI**
   - A small dismissible banner/toast in the dark theme, shown only in the `downloaded` state, with the three buttons. Optional subtle progress chip during `downloading`. `checking` / `none` states render nothing. No modal, nothing blocking.

### Data shape

```ts
type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; version: string; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string };
```

### Error handling

All updater errors (offline, GitHub unreachable, checksum mismatch) are caught, logged locally, and surfaced as a silent no-op — the app never blocks or alerts on a failed check. electron-updater verifies the SHA512 from the feed before installing, so a corrupt/partial download cannot install.

### Testing

- Unit-test (vitest, no Electron): the skip-version decision (offered vs skipped vs new) and the `UpdateStatus` state transitions as a pure reducer.
- Manual gate (documented, like the hardware gates): a real signed build + a GitHub pre-release to verify the end-to-end download→install round-trip on macOS.

### Packaging note

`electron-updater` becomes a runtime dependency of `@xyst/app`; electron-vite bundles it into `out/` like everything else, so the "ship `out/` + package.json only" packaging is unchanged.

---

## Part B — Local API hardening (audit C1, the release-blocker)

**Problem:** `core/server/api.ts` binds loopback (good) but sets `Access-Control-Allow-Origin: *` on all routes, validates no `Origin`/`Host`, and requires no auth. Any website the operator visits can drive cameras / delete profiles / start record and read camera IPs + state back. DNS-rebinding + CSRF.

**Defense layers (all three):**

1. **Host-header allow-list** — reject any request whose `Host` is not `127.0.0.1:<port>` or `localhost:<port>`. This alone defeats DNS-rebinding (the attack relies on the browser sending the attacker's hostname in `Host`).

2. **Bearer token** — generate a random token once and persist it in `userData` (stable across restarts, so it can be configured once, not regenerated each launch). Require it on every route.
   - The renderer receives it over the existing `app:apiBase` IPC path (extended to also carry the token).
   - `EventSource` (SSE `/api/events`) and `<img>` (`preview.jpg`) cannot set headers, so those GET routes accept the token as a query param; all other routes accept it as an `Authorization: Bearer` header.
   - Companion (server-to-server) receives the token via a new field in its module config; the app surfaces the token in a settings/about area for copy-paste.

3. **Drop wildcard CORS** — stop sending `Access-Control-Allow-Origin: *`. Reflect only the app's own renderer origin (or none); cross-origin browser reads of camera state/frames are no longer possible.

**Result:** browser-based attackers are blocked at the Host check and the missing CORS; the bearer token gates any non-browser client. Companion and the first-party renderer keep working.

---

## Part C — Electron shell hardening (audit H1, H2)

In `packages/app/src/main`:

1. **Navigation lockdown** — add an `app.on('web-contents-created', …)` that installs `contents.setWindowOpenHandler(() => ({ action: 'deny' }))` and a `will-navigate` / `will-redirect` handler blocking navigation to any origin other than the app's own. (Currently absent.)

2. **Scope the media permission** — change the `setPermissionRequestHandler` so camera/mic is granted only when `webContents.getURL()` is the app's first-party origin, instead of unconditionally for any `media` request.

3. **Content-Security-Policy** — add a restrictive CSP via `session.defaultSession.webRequest.onHeadersReceived` (preferred over a `<meta>` so it also covers the dev server). Baseline:
   `default-src 'self'; img-src 'self' http://127.0.0.1:* data:; connect-src 'self' http://127.0.0.1:*; script-src 'self'; style-src 'self' 'unsafe-inline'`
   (tighten `style-src` if the UI doesn't need inline styles).

---

## Part D — Release hygiene

1. **Version sync (audit H3)** — single-source the version so root / `@xyst/core` / `@xyst/app` / the Companion `manifest.json` all agree. The Companion manifest currently ships `0.0.0` (most visible bug) and the app is `0.4.0` while others are `0.1.0`. Align them to the app's `0.4.0` (or the next release tag) before tagging.

2. **Codify notarize + staple (audit M1)** — add `scripts/notarize-dmg.sh` (codesign the `.dmg` → `xcrun notarytool submit --wait` → `xcrun stapler staple`), wired so `pnpm package` can't ship an un-stapled DMG. Verify with `spctl -a -t open --context context:primary-signature <dmg>`. Credentials continue to come from `~/.xyst-notarize.env` (out of repo).

---

## Part E — Crash guard (audit M4)

Add top-level `process.on('uncaughtException', …)` and `process.on('unhandledRejection', …)` handlers in the main process that **log and keep the app running** rather than letting Electron's default surface a dialog / terminate the process mid-show. Local logging only — no remote upload.

---

## Out of this plan (tracked, not done here)

- M2 `disable-library-validation` trim, L1 console-log gating, L2 Keychain creds, M5 `.work/` gitignore. Optional follow-ups; none block release.

## Implementation order

1. **B (C1)** — API hardening: the one true blocker.
2. **C (H1/H2)** — shell hardening.
3. **A** — auto-updater (build config → main `updater.ts` → IPC/preload → renderer banner → tests).
4. **D (H3/M1)** — version sync + notarize script.
5. **E (M4)** — crash guard.

## Verification

- `pnpm -r typecheck` and `pnpm -r test` green (117 tests today; new updater reducer tests added).
- Manual: signed build + GitHub pre-release verifies the update round-trip on macOS.
- Manual: confirm a cross-origin browser POST to `127.0.0.1:<port>` is rejected after Part B.
- Manual: `spctl` assessment passes on the stapled DMG after Part D.
