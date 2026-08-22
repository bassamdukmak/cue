#!/bin/bash
# Build cue into a real macOS app and install it to /Applications.
#
# Why this exists: `npm start` runs raw Electron, so macOS identifies the app as
# "Electron" (com.github.Electron) with an ad-hoc signature that changes on every
# npm install. Microphone and Screen Recording grants are tied to that signature,
# so they silently break after every reinstall. A packaged bundle has a stable
# identity (com.cue.overlay) and keeps its permissions.
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> Building (with the whisper.cpp runtime bundled)"
# A packaged app only looks for the runtime inside its own Resources directory —
# the .cache/ copy is used solely when running unpackaged via `npm start`. Without
# this flag the installed app has no local transcription at all.
if [ ! -x ".cache/whisper-runtime/darwin-arm64/whisper-server" ]; then
  echo "    (building whisper.cpp first — needs cmake)"
  npm run prepare:whisper
fi
if [ ! -x ".cache/ocr/cue-ocr" ]; then
  echo "    (building local OCR runtime)"
  npm run prepare:ocr
fi
CUE_BUNDLE_WHISPER=1 npm run pack

# Spotlight indexes anything that looks like an app, so the build output shows up
# as a second "cue" alongside the installed one. This marker keeps dist/ out of
# the index.
mkdir -p dist && touch dist/.metadata_never_index

# Ad-hoc signing WITHOUT the hardened runtime, matching electron-builder.cjs,
# which enables it only when a real certificate exists. Ad-hoc + hardened runtime
# makes macOS pin Screen Recording to the exact code hash, so the grant dies on
# every rebuild while still showing as ticked in System Settings.
# Sign with a stable local identity when one exists, falling back to ad-hoc.
# This is what stops the permission treadmill: macOS ties Screen Recording and
# Microphone grants to the signing identity, so an ad-hoc signature (which
# changes on every build) silently invalidated them each time. A fixed identity
# keeps the grants across rebuilds.
SIGN_ID="cue-dev-signing"
if security find-identity -p codesigning -v 2>/dev/null | grep -q "$SIGN_ID"; then
  echo "==> Signing with stable identity: $SIGN_ID"
else
  echo "==> No '$SIGN_ID' identity found — falling back to ad-hoc (permissions will reset)"
  SIGN_ID="-"
fi
codesign --force --deep --sign "$SIGN_ID" \
  --identifier com.cue.overlay \
  --entitlements build-resources/entitlements.mac.plist \
  dist/mac-arm64/cue.app

echo "==> Installing to /Applications"
osascript -e 'quit app "cue"' 2>/dev/null || true
sleep 1
rm -rf /Applications/cue.app
ditto dist/mac-arm64/cue.app /Applications/cue.app
xattr -cr /Applications/cue.app

# Leave only the installed copy on disk, so Spotlight has one "cue" to offer.
rm -rf dist/mac-arm64/cue.app

killall Dock 2>/dev/null || true
echo "==> Done. Open it from Applications or Spotlight."
