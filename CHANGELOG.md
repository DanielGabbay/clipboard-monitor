# Changelog

All notable changes to Clipboard Monitor are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/). The version itself lives in the `VERSION` file.

## [1.1.0] - Unreleased

### Added
- Hebrew and English interface, chosen in Settings or following the macOS language. The window chrome, settings,
  context menu, cards and the macOS menus switch to right-to-left in Hebrew; clipboard content keeps its own
  per-block direction.
- Tabbed settings: General, Content, History & privacy, Features, AI and About.
- Feature switches to turn off translation, AI, smart cards (each card type separately), Compare, link preview and
  Copy RTL.
- AI providers and models: OpenAI, Anthropic, Google Gemini, OpenRouter, Ollama, LM Studio and any
  OpenAI-compatible endpoint. Add, edit, disable or delete providers, check a provider or a model (status and
  response time), hide models, and refresh the model list manually or automatically (new models arrive hidden and
  marked "new"). API keys are stored in the macOS Keychain and never reach the page, the settings or the logs.
- Translation through an LLM provider and model of your choice, keeping Markdown structure and leaving code and
  URLs untouched, with Apple's on-device translation as an alternative engine and as a fallback.
- "Translate to…" for any target language in the list, next to the automatic Hebrew ↔ English translation.
- About tab with the version, build number, commit, build date, macOS version and the release notes.

### Changed
- The build stamps the version from `VERSION`, the build number from the commit count, and the commit and build
  date into the app bundle.
- The build signs with a stable local identity ("Clipboard Monitor Dev") when one exists, so the Keychain does
  not ask for access again after every rebuild.

## [1.0.0] - 2026-10-13

### Added
- Live view of the current clipboard with correct BiDi: each line, paragraph, list and table gets its own direction;
  code stays left to right.
- Rendering of Markdown (GFM), sanitized rich text from web pages, pretty-printed JSON, images and plain text, with
  syntax highlighting for code blocks.
- Copy RTL: copies the text back with Hebrew lines wrapped in Unicode isolates for apps without RTL support.
- Smart cards for JWTs, JSON (tree with a path filter), colors, timestamps, Base64 and links (with an on-demand
  page preview).
- Compare the shown item with any history item, line by line with changed words highlighted.
- Hebrew ↔ English translation with Apple's on-device Translation framework (macOS 26+).
- Searchable history with pinning, deleting and a right-click menu, optionally kept across restarts.
- Multiple windows and native tabs, each following the clipboard, with Hold to freeze one on an item.
- Always on top, show on all desktops, a global show/hide shortcut, launch at login and light/dark/system
  appearance.
- Privacy: concealed password-manager items are never shown or saved, and specific apps can be ignored.
