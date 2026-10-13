#!/bin/bash
# Build Clipboard Monitor.app with the Xcode command line tools (no Xcode project needed).
#   ./build.sh            build into ./build
#   ./build.sh install    build, copy to ~/Applications and launch
set -euo pipefail
cd "$(dirname "$0")"
command -v swiftc >/dev/null || { echo "swiftc not found: run  xcode-select --install"; exit 1; }

APP="build/Clipboard Monitor.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
swiftc -O -o "$APP/Contents/MacOS/ClipboardMonitor" Sources/main.swift \
  -framework Cocoa -framework WebKit 2>&1 | grep -v "^$" || true
[ -x "$APP/Contents/MacOS/ClipboardMonitor" ] || { echo "build failed"; exit 1; }
cp Info.plist "$APP/Contents/"
cp Resources/* "$APP/Contents/Resources/"
# App icon: icon/icon.svg -> 1024px PNG -> AppIcon.icns
ICONSET=build/AppIcon.iconset; rm -rf "$ICONSET"; mkdir -p "$ICONSET"
swiftc -O -o build/render-icon icon/render-icon.swift -framework AppKit
build/render-icon icon/icon.svg build/icon_1024.png 1024
for sz in 16 32 128 256 512; do
  sips -z $sz $sz build/icon_1024.png --out "$ICONSET/icon_${sz}x${sz}.png" >/dev/null
  sips -z $((sz*2)) $((sz*2)) build/icon_1024.png --out "$ICONSET/icon_${sz}x${sz}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/AppIcon.icns"
codesign --force --deep -s - "$APP" >/dev/null
echo "built: $APP"

if [ "${1:-}" = "install" ]; then
  mkdir -p ~/Applications
  pkill -x ClipboardMonitor 2>/dev/null && sleep 1 || true
  rm -rf ~/Applications/"Clipboard Monitor.app"
  cp -R "$APP" ~/Applications/
  touch ~/Applications/"Clipboard Monitor.app"   # refresh the Dock/Finder icon cache
  open ~/Applications/"Clipboard Monitor.app"
  echo "installed: ~/Applications/Clipboard Monitor.app"
fi
