#!/usr/bin/env bash
# One-shot cross-platform release. Run from the repo root on the release branch (phase-1):
#   bash scripts/release.sh 0.7.0
#
# What it does, end to end (no other manual steps):
#   1. bumps the version in all four package.json files + commits + pushes phase-1
#   2. tags vX.Y.Z and pushes it — which triggers the GitHub Actions WINDOWS build
#   3. pre-creates the (non-draft) GitHub release so the parallel uploaders never race to create
#      duplicates (the bug that bit the first 0.6.0 publish)
#   4. builds the UNIVERSAL macOS app, notarizes it, and publishes the .dmg/.zip/feed to the release
#   5. notarizes + staples the .dmg container and re-uploads it (Gatekeeper-clean download)
#   6. leaves the Windows installer to finish building in CI and attach itself to the same release
#
# Prereqs (one-time, already set up on this Mac): ~/.xyst-notarize.env present, `gh` logged in,
# a "Developer ID Application" identity in the login keychain, pnpm installed.
set -euo pipefail

VERSION="${1:-}"
[[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "usage: $0 <x.y.z>   e.g. $0 0.7.0" >&2; exit 1; }
TAG="v$VERSION"

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

OWNER_REPO="missedthepoint1/xyst-control"
RELEASE_BRANCH="phase-1"
PRODUCT="XYST CONTROL"   # space-named build output; release assets use the hyphenated form

# --- preflight -------------------------------------------------------------
command -v gh   >/dev/null || { echo "gh CLI not found" >&2; exit 1; }
command -v pnpm >/dev/null || { echo "pnpm not found" >&2; exit 1; }
[ -f "$HOME/.xyst-notarize.env" ] || { echo "missing ~/.xyst-notarize.env (Apple creds)" >&2; exit 1; }
gh auth token >/dev/null 2>&1 || { echo "gh not authenticated (run: gh auth login)" >&2; exit 1; }

BRANCH="$(git rev-parse --abbrev-ref HEAD)"
[ "$BRANCH" = "$RELEASE_BRANCH" ] || { echo "on '$BRANCH', expected '$RELEASE_BRANCH'" >&2; exit 1; }
git diff --quiet && git diff --cached --quiet || { echo "working tree not clean — commit or stash first" >&2; exit 1; }
git rev-parse "$TAG" >/dev/null 2>&1 && { echo "tag $TAG already exists — pick a new version" >&2; exit 1; }
gh release view "$TAG" --repo "$OWNER_REPO" >/dev/null 2>&1 && { echo "release $TAG already exists" >&2; exit 1; }

echo "==> releasing $TAG"

# --- 1. bump versions ------------------------------------------------------
for d in . packages/app packages/core packages/companion-module; do
  ( cd "$d" && npm pkg set version="$VERSION" >/dev/null )
done
git add package.json packages/*/package.json
git commit -q -m "chore: bump version to $VERSION"
git push -q origin "$RELEASE_BRANCH"

# --- 2. tag (kicks off the CI Windows build) -------------------------------
git tag -a "$TAG" -m "$TAG"
git push -q origin "$TAG"
echo "==> tagged + pushed $TAG (Windows build now starting in CI)"

# --- 3. pre-create the release so uploaders don't race to create it --------
gh release view "$TAG" --repo "$OWNER_REPO" >/dev/null 2>&1 \
  || gh release create "$TAG" --repo "$OWNER_REPO" --title "$TAG" --generate-notes --target "$(git rev-parse HEAD)"

# --- 4. build + notarize + publish macOS -----------------------------------
echo "==> building + notarizing + publishing macOS (a few minutes)"
set -a; . "$HOME/.xyst-notarize.env"; set +a
export GH_TOKEN="$(gh auth token)"
pnpm --filter @xyst/app exec electron-vite build
pnpm --filter @xyst/app exec electron-builder --publish always

# --- 5. notarize + staple the .dmg container, re-upload it -----------------
DMG_BUILT="packages/app/release/${PRODUCT}-${VERSION}-universal.dmg"
DMG_ASSET="packages/app/release/$(echo "$PRODUCT" | tr ' ' '-')-${VERSION}-universal.dmg"
bash scripts/notarize-dmg.sh "$DMG_BUILT"
cp "$DMG_BUILT" "$DMG_ASSET"
gh release upload "$TAG" "$DMG_ASSET" --repo "$OWNER_REPO" --clobber

echo
echo "==> macOS done (signed + notarized, dmg stapled)."
echo "    Windows installer is building in CI and will attach to the same release:"
echo "      gh run watch \$(gh run list --workflow=release.yml -L1 --json databaseId --jq '.[0].databaseId') --exit-status"
echo "    Release: https://github.com/$OWNER_REPO/releases/tag/$TAG"
