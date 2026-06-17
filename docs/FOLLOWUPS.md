# Release-Readiness Follow-ups (deferred, non-blocking)

Deferred items from the release-readiness pass (PR #1 → 0.5.0). None block the
Developer-ID + notarized release; track and pick up as needed.

Context: `docs/superpowers/specs/2026-06-17-release-readiness-design.md`,
`docs/superpowers/plans/2026-06-17-release-readiness.md`.

## Security / hardening

- [ ] **macOS Keychain for camera credentials** (audit L2). Basic/Digest passwords are
  currently written plaintext to `cameras.json` in userData. Store them via Electron
  `safeStorage` instead. Acceptable today (single-operator machine, LAN creds, never
  logged) but worth tightening.
- [ ] **Trim `com.apple.security.cs.disable-library-validation`** (audit M2). Broader than
  the current bundle needs (no third-party native dylibs yet). Try removing it from
  `packages/app/build/entitlements.mac.plist` and re-notarize; restore only if a native
  module fails to load. **Keep documented against the future Sony SDK sidecar**, which
  will need it.
- [ ] **Gate production `console.*` logging behind a debug flag** (audit L1). Low-volume
  and no secrets, but noisy in a release build.

## Windows distribution

- [ ] **Windows code-signing.** Auto-update is wired for Windows (NSIS) but binaries are
  unsigned, so updates trigger SmartScreen warnings and skip electron-updater's
  publisher-signature check. Set up an Authenticode/EV cert + electron-builder signing
  config to make Windows updates clean.

## Repo hygiene

- [ ] **Gitignore `.work/`** (ad-hoc debug scripts) and **confirm `sony-sdk/`
  redistribution rights** for the public repo (audit M5). Neither ships in the packaged
  app (`files: out/** + package.json`), so this is repo cleanliness, not a binary concern.

## Manual release gates (run when cutting 0.5.0)

- [ ] Cross-origin browser `fetch('http://127.0.0.1:8088/api/cameras')` is rejected (not
  200 with data).
- [ ] `pnpm package` → `scripts/notarize-dmg.sh` → stapled DMG passes
  `spctl -a -t open --context context:primary-signature`.
- [ ] Installed 0.4.0 picks up 0.5.0 from GitHub Releases → banner appears → Install &
  Restart relaunches on the new version → Skip suppresses re-notify (README "Auto-update").
