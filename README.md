# Clipboard Monitor

A small macOS app that keeps the current clipboard on screen, rendered properly, with first-class support for
mixed **Hebrew / English (RTL + LTR)** text. Park it on the side of a monitor and every copy shows up in it.

## Features

- **Correct BiDi everywhere.** Each line, paragraph, list and table gets its own direction, so a sentence like
  "React Native הוא framework..." reads right to left even though it starts in English. Code stays left to right.
- **Renders what you copy.** Markdown (GFM: tables, task lists, code fences), rich text copied from web pages
  (sanitized), pretty-printed JSON, images, and plain text. Syntax highlighting for code blocks.
- **Copy RTL.** Copies the text back with every Hebrew line wrapped in Unicode isolates (RLI…PDI), so it pastes
  correctly into apps that have no RTL support. Code fences are left untouched.
- **Smart cards.** A copied JWT is decoded (claims, expiry), JSON gets a collapsible tree with a path filter
  (`.items[].name`), and colors, timestamps, Base64 and links get their own card (color formats, dates, decoded
  text, URL parts and an on-demand page preview).
- **Compare.** Diff the shown item against any history item, line by line with changed words highlighted.
- **Translate.** Hebrew ↔ English with Apple's on-device Translation framework (macOS 26+). Nothing leaves the Mac.
- **History.** Searchable, with pinning, deleting and a right-click menu. Optionally kept across restarts.
- **Multiple monitors.** Open more windows (⌘N) or native macOS tabs (⌘T). Hold (⌘L) freezes one window on an
  item while the others keep following the clipboard.
- **Stays out of the way.** Always-on-top, show on all desktops, a global show/hide shortcut, launch at login,
  light/dark/system appearance.
- **Private.** Everything stays on your Mac. Items marked as concealed by password managers
  ([nspasteboard.org](http://nspasteboard.org) types) are never shown or saved, and you can ignore specific apps.

## Build

Requires macOS 13+ and the Xcode command line tools (`xcode-select --install`). No Xcode project is needed.

```sh
./build.sh            # builds "build/Clipboard Monitor.app"
./build.sh install    # builds, copies to ~/Applications and launches
```

The app is ad-hoc signed for local use.

## Shortcuts

| Shortcut | Action |
|---|---|
| ⌃⌥V (configurable) | Show / hide from any app |
| ⌘N / ⌘T | New window / new tab |
| ⌘L | Hold the shown item (stop following the clipboard) |
| ⌘R | Raw / rendered |
| ⌘Y | History |
| ⇧⌘C | Copy with RTL marks |
| ⇧⌘T | Always on top |
| ⇧⌘P | Pause monitoring |
| ⌘, | Settings |
| ⌘+ / ⌘- / ⌘0 | Text size |

## How it works

- `Sources/main.swift`: the AppKit shell. Polls `NSPasteboard.changeCount`, manages windows, tabs, settings,
  the global hot key (Carbon, no Accessibility permission needed) and the login item (`SMAppService`).
- `Resources/index.html`: the renderer and settings UI, running in a `WKWebView`.
- `Resources/bidi-fix.js`: the BiDi engine. It sets `dir` per block by the share of Hebrew letters
  ("majority", the default) or by the first strong character, and isolates inline code and links.
- `icon/icon.svg`: the app icon source, rendered to `AppIcon.icns` during the build.

## Third-party

- [marked](https://github.com/markedjs/marked) 14.1.4 (MIT), `Resources/marked.min.js`
- [highlight.js](https://github.com/highlightjs/highlight.js) 11.10.0 (BSD-3-Clause), `Resources/highlight.min.js`, `Resources/hljs.css`

## License

MIT
