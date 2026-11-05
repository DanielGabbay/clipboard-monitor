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
- **Translate.** Automatic Hebrew ↔ English, or "Translate to…" any language in your list. Use an LLM provider and
  model of your choice (Markdown structure, code and URLs are kept), or Apple's on-device Translation framework
  (macOS 26+), which also serves as the fallback when the LLM call fails.
- **AI providers.** OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, LM Studio or any OpenAI-compatible
  endpoint. Check a provider or a single model, hide models you do not use, and let the model list refresh on its
  own (new models arrive hidden and marked "new"). API keys live in the macOS Keychain only: never in the settings,
  the provider file, the page or the logs.
- **Hebrew or English interface.** Follows the macOS language or your choice. In Hebrew the window chrome,
  settings, menus and cards switch to right to left; clipboard content keeps its own per-block direction.
- **Settings in tabs.** General, Content, History & privacy, Features (switch off translation, AI, each smart card,
  Compare, link preview or Copy RTL), AI, and About (version, build, commit, build date and what's new).
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

The build prints the version and build number (`built: … v1.1.0 (57)`).

### Version

`VERSION` is the single source of truth for the version. `build.sh` writes it into the bundle's `Info.plist`
together with the build number (the git commit count), the commit (`CMGitCommit`), the build date (`CMBuildDate`,
UTC) and whether there were uncommitted changes (`CMDirty`). The version keys in the source `Info.plist` are
placeholders that the build overwrites in the app bundle; leave them alone. `CHANGELOG.md`
([Keep a Changelog](https://keepachangelog.com/)) is bundled too, and Settings › About shows the section of the
current version.

To cut a release:

```sh
scripts/release.sh 1.2.0 --dry-run   # show what would happen
scripts/release.sh 1.2.0             # VERSION, CHANGELOG heading, commit "Release v1.2.0", tag v1.2.0 (no push)
git push && git push origin v1.2.0
```

The script needs a clean working tree. It turns `## [Unreleased]` (or `## [1.2.0] - Unreleased`) into
`## [1.2.0] - <today>` and adds a new empty `## [Unreleased]` section above it.

### Signing

API keys are stored in the Keychain, and the Keychain remembers which app may read them by its code signature. An
ad-hoc signature changes with every build, so each rebuild would ask for access again. Create a stable local
signing identity once:

```sh
scripts/make-signing-identity.sh
```

It makes a self-signed code-signing certificate named "Clipboard Monitor Dev" (valid 10 years) and imports it with
its key into the login keychain. `build.sh` then signs with it automatically. If codesign refuses it, open the
certificate in Keychain Access and set Trust › Code Signing to "Always Trust" (the script prints the steps).
`build.sh` uses, in order: `$CODESIGN_IDENTITY` if set, the "Clipboard Monitor Dev" identity if present, otherwise
an ad-hoc signature with a warning.

### UI preview in a browser

The page can run in any browser against a fake native side (`dev/mock-bridge.js`), with no build:

```sh
dev/preview.sh                                   # writes dev/preview.html
python3 -m http.server 8794 --bind localhost     # from the project root
# open http://localhost:8794/dev/preview.html
```

In the console: `monitor.toggleSettings(true)`, `MOCK.lang('he')` / `MOCK.lang('en')`, `MOCK.push('text')`,
`MOCK.fail = true` (make AI checks fail). See `dev/README.md`.

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

- `Sources/main.swift`: the AppKit shell. Polls `NSPasteboard.changeCount`, manages windows, tabs, menus,
  the global hot key (Carbon, no Accessibility permission needed) and the login item (`SMAppService`).
  Next to it: `Settings.swift`, `Localization.swift` (menu strings), `Translation.swift` (Apple / LLM router),
  `AI/` (providers, models, Keychain) and `Version.swift`.
- `Resources/index.html` + `app.css`: the page, running in a `WKWebView`. `renderer.js` renders the clipboard,
  `settings.js` runs the settings tabs, and `settings-features.js`, `settings-ai.js` and `settings-about.js` fill
  their tabs. `i18n.js` is the string engine; each module registers its own English and Hebrew strings.
- `Resources/bidi-fix.js`: the BiDi engine. It sets `dir` per block by the share of Hebrew letters
  ("majority", the default) or by the first strong character, and isolates inline code and links.
- `icon/icon.svg`: the app icon source, rendered to `AppIcon.icns` during the build.

## Third-party

- [marked](https://github.com/markedjs/marked) 14.1.4 (MIT), `Resources/marked.min.js`
- [highlight.js](https://github.com/highlightjs/highlight.js) 11.10.0 (BSD-3-Clause), `Resources/highlight.min.js`, `Resources/hljs.css`

## License

MIT
