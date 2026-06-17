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
