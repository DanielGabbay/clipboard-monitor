#!/bin/bash
# Build Clipboard Monitor.app with the Xcode command line tools (no Xcode project needed).
#   ./build.sh            build into ./build
#   ./build.sh install    build, copy to ~/Applications and launch
#
# Version: VERSION holds the marketing version; the build number is the git commit count. Both, plus the commit,
# the build date and a "modified" flag, are written into the bundle's Info.plist (the source Info.plist is not touched).
# Signing: $CODESIGN_IDENTITY if set, else the "Clipboard Monitor Dev" identity (scripts/make-signing-identity.sh)
# when it exists, else ad-hoc.
set -euo pipefail
cd "$(dirname "$0")"
command -v swiftc >/dev/null || { echo "swiftc not found: run  xcode-select --install"; exit 1; }

APP="build/Clipboard Monitor.app"
DEV_IDENTITY="Clipboard Monitor Dev"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
# Every Swift file under Sources/ (main.swift holds the top-level entry point).
SOURCES=(); while IFS= read -r f; do SOURCES+=("$f"); done < <(find Sources -name '*.swift' | sort)
swiftc -O -o "$APP/Contents/MacOS/ClipboardMonitor" "${SOURCES[@]}" \
  -framework Cocoa -framework WebKit -framework Security 2>&1 | grep -v "^$" || true
[ -x "$APP/Contents/MacOS/ClipboardMonitor" ] || { echo "build failed"; exit 1; }
cp Info.plist "$APP/Contents/"
cp Resources/* "$APP/Contents/Resources/"
cp CHANGELOG.md "$APP/Contents/Resources/"

# ---- version stamp (bundle copy of Info.plist only) -----------------------------------------------------
VERSION=$(tr -d '[:space:]' < VERSION)
if git rev-parse --git-dir >/dev/null 2>&1; then
  BUILD=$(git rev-list --count HEAD 2>/dev/null || echo 0)
  COMMIT=$(git rev-parse --short HEAD 2>/dev/null || echo unknown)
  if [ -n "$(git status --porcelain 2>/dev/null)" ]; then DIRTY=1; else DIRTY=0; fi
else
  BUILD=0; COMMIT=unknown; DIRTY=0
fi
BUILD_DATE=$(date -u +%Y-%m-%dT%H:%M:%SZ)
PLIST="$APP/Contents/Info.plist"
pb() { /usr/libexec/PlistBuddy -c "Set :$1 $2" "$PLIST" 2>/dev/null || /usr/libexec/PlistBuddy -c "Add :$1 string $2" "$PLIST"; }
pb CFBundleShortVersionString "$VERSION"
pb CFBundleVersion "$BUILD"
pb CMGitCommit "$COMMIT"
pb CMBuildDate "$BUILD_DATE"
pb CMDirty "$DIRTY"

# ---- app icon: icon/icon.svg -> 1024px PNG -> AppIcon.icns ----------------------------------------------
ICONSET=build/AppIcon.iconset; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
swiftc -O -o build/render-icon icon/render-icon.swift -framework AppKit
build/render-icon icon/icon.svg build/icon_1024.png 1024
for sz in 16 32 128 256 512; do
  sips -z $sz $sz build/icon_1024.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) build/icon_1024.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"

# ---- signing --------------------------------------------------------------------------------------------
# A stable identity keeps the app's code requirement the same across rebuilds, so Keychain items (AI keys) stay
# readable without a prompt. Ad-hoc signatures change with every build.
# sign <identity>: codesign the bundle, hiding only its "replacing existing signature" notice.
sign() {
  local out; out=$(codesign --force --deep -s "$1" "$APP" 2>&1) || { echo "$out" >&2; return 1; }
  echo "$out" | grep -v -e 'replacing existing signature' -e '^$' >&2 || true
}
SIGNED_WITH=""
if [ -n "${CODESIGN_IDENTITY:-}" ]; then
  sign "$CODESIGN_IDENTITY"
  SIGNED_WITH="$CODESIGN_IDENTITY"
else
  # Listed even when not trusted; use the SHA-1 so a duplicate name is not ambiguous.
  DEV_HASH=$(security find-identity -p codesigning 2>/dev/null | grep -F "\"$DEV_IDENTITY\"" | awk '{print $2}' | head -n 1 || true)
  if [ -n "$DEV_HASH" ]; then
    if sign "$DEV_HASH" 2>/dev/null; then SIGNED_WITH="$DEV_IDENTITY"
    else echo "warning: codesign refused the \"$DEV_IDENTITY\" identity (see scripts/make-signing-identity.sh)"; fi
  fi
fi
if [ -z "$SIGNED_WITH" ]; then
  sign -
  echo "warning: ad-hoc signed; Keychain will ask for access after each rebuild (run scripts/make-signing-identity.sh once)"
fi
echo "built: $APP v$VERSION ($BUILD)${SIGNED_WITH:+, signed: $SIGNED_WITH}"

if [ "${1:-}" = "install" ]; then
  mkdir -p ~/Applications
  pkill -x ClipboardMonitor 2>/dev/null && sleep 1 || true
  rm -rf ~/Applications/"Clipboard Monitor.app"
  cp -R "$APP" ~/Applications/
  touch ~/Applications/"Clipboard Monitor.app"   # refresh the Dock/Finder icon cache
  open ~/Applications/"Clipboard Monitor.app"
  echo "installed: ~/Applications/Clipboard Monitor.app"
fi
