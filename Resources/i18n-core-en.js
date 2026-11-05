// English strings for the core page (header, renderer, context menu, General / Content / History settings).
// Hebrew lives in i18n-core-he.js with the same keys. Modules (settings-*.js) register their own strings.
I18N.register({ en: {
  // header
  'header.paused': 'Paused',
  'header.raw': 'Raw', 'header.raw.title': 'Raw / rendered (⌘R)',
  'header.copy': 'Copy', 'header.copy.title': 'Copy shown item back to the clipboard',
  'header.copyRtl': 'Copy RTL', 'header.copyRtl.title': 'Copy with Hebrew lines wrapped in RLI…PDI, for pasting into apps without RTL support (⇧⌘C)',
  'header.hold': 'Hold', 'header.hold.title': 'Hold this item: this window stops following the clipboard (⌘L)',
  'header.history.title': 'History (⌘Y)',
  'header.theme.title': 'Appearance: System / Light / Dark',
  'header.settings.title': 'Settings (⌘,)',
  'header.chars': '{n} chars',
  'header.historyPos': 'history {i}/{n}',
  'title.live': 'Clipboard',
  'title.held': 'Held',

  // content
  'empty.copy': 'Copy something…',
  'content.image': 'Image {size}',
  'content.imageHidden': 'Image {size} (hidden in Settings)',
  'content.secret': 'Hidden: the copying app marked this as a password/secret.',
  'content.other': 'Non-text content ({types})',
  'content.unknown': 'unknown',
  'fmt.markdown': 'Markdown', 'fmt.rich': 'Rich text', 'fmt.text': 'Text', 'fmt.json': 'JSON',
  'fmt.image': 'Image', 'fmt.secret': 'Secret', 'fmt.other': 'Other',

  // history
  'history.search': 'Search history…',
  'history.pinned': 'Pinned', 'history.recent': 'Recent',
  'history.noMatches': 'No matches', 'history.empty': 'Empty',
  'history.hidden': 'Hidden',

  // smart cards
  'smart.clickToCopy': 'Click to copy',
  'smart.jwt': 'JWT', 'smart.jwt.expired': 'Expired {when}', 'smart.jwt.valid': 'Valid, expires {when}',
  'smart.jwt.header': 'Header', 'smart.jwt.payload': 'Payload', 'smart.jwt.unverified': 'Signature is not verified.',
  'smart.link': 'Link', 'smart.link.host': 'host', 'smart.link.path': 'path', 'smart.link.hash': 'hash',
  'smart.link.query': 'Query parameters', 'smart.link.open': 'Open', 'smart.link.preview': 'Load preview',
  'smart.link.loading': 'Loading…', 'smart.link.previewFailed': 'Preview failed: {error}',
  'smart.color': 'Color',
  'smart.time': 'Date & time', 'smart.time.unixS': 'Unix (s)', 'smart.time.unixMs': 'Unix (ms)',
  'smart.json': 'JSON', 'smart.json.syntax': 'Use .key, [0] or [] (e.g. .items[].name)',
  'smart.json.filter': 'Filter: .key, [0], .items[].name', 'smart.json.copyMin': 'Copy minified',
  'smart.json.copyResult': 'Copy result', 'smart.json.noMatch': 'No match',
  'smart.base64': 'Base64', 'smart.base64.decoded': 'Decoded', 'smart.base64.copy': 'Copy decoded',

  // compare
  'compare.chip': 'Compare', 'compare.close': 'Close', 'compare.tooLarge': 'Too large to compare.',
  'compare.identical': 'The two items are identical.', 'compare.button': 'Compare…',
  'compare.picking': 'Pick an item in History…', 'compare.title': 'Compare with another history item',

  // translation
  'tr.showOriginal': 'Show original', 'tr.showTranslation': 'Show translation', 'tr.onDevice': 'on-device',
  'tr.translating': 'Translating…', 'tr.toEnglish': 'Translate to English', 'tr.toHebrew': 'Translate to Hebrew',
  'tr.err.notInstalled': "The {from} → {to} language pack isn't downloaded yet. Download it once in System Settings › General › Language & Region › Translation Languages; after that translation works offline.",
  'tr.openLanguages': 'Open Translation Languages', 'tr.tryAgain': 'Try again',
  'tr.err.unsupported': 'On-device translation needs macOS 26 or later.',
  'tr.err.failed': 'Translation failed: {error}',

  // context menu
  'menu.copySelection': 'Copy Selection', 'menu.copySelectionRtl': 'Copy Selection with RTL Marks',
  'menu.copy': 'Copy', 'menu.copyRtl': 'Copy with RTL Marks', 'menu.pin': 'Pin', 'menu.unpin': 'Unpin',
  'menu.openInWindow': 'Open in New Window', 'menu.follow': 'Follow the Clipboard', 'menu.hold': 'Hold This Item',
  'menu.show': 'Show', 'menu.showRendered': 'Show Rendered', 'menu.showRaw': 'Show Raw Text',
  'menu.compareWithShown': 'Compare with Shown Item', 'menu.closeCompare': 'Close Comparison', 'menu.delete': 'Delete',

  // toasts
  'toast.copied': 'Copied', 'toast.copiedRtl': 'Copied with RTL marks',
  'toast.holding': 'Holding this item', 'toast.following': 'Following the clipboard',
  'toast.appearance': 'Appearance: {theme}',

  // settings shell
  'settings.title': 'Settings', 'settings.done': 'Done', 'settings.done.title': 'Close (Esc)',
  'settings.tab.general': 'General', 'settings.tab.content': 'Content', 'settings.tab.history': 'History',
  'settings.tab.features': 'Features', 'settings.tab.ai': 'AI', 'settings.tab.about': 'About',

  // General tab
  'settings.general.language': 'Language',
  'settings.general.uiLang': 'Interface language', 'settings.general.uiLang.hint': 'System follows the macOS language.',
  'settings.general.uiLang.system': 'System',
  'settings.general.appearance': 'Appearance',
  'settings.general.theme': 'Theme', 'settings.general.theme.system': 'System', 'settings.general.theme.light': 'Light', 'settings.general.theme.dark': 'Dark',
  'settings.general.font': 'Font', 'settings.general.font.system': 'System', 'settings.general.font.rounded': 'Rounded',
  'settings.general.font.serif': 'Serif', 'settings.general.font.mono': 'Monospaced',
  'settings.general.zoom': 'Text size',
  'settings.general.window': 'Window',
  'settings.general.onTop': 'Always on top', 'settings.general.allSpaces': 'Show on all desktops',
  'settings.general.newMonitor': 'New monitor',
  'settings.general.newMonitor.hint': 'Each window or tab follows the clipboard on its own; use Hold to keep one on a single item.',
  'settings.general.newWindow': 'New window ⌘N', 'settings.general.newTab': 'New tab ⌘T',
  'settings.general.startup': 'Startup & shortcut',
  'settings.general.loginItem': 'Launch at login',
  'settings.general.hotkey': 'Show / hide shortcut', 'settings.general.hotkey.hint': 'Works from any app.', 'settings.general.hotkey.off': 'Off',

  // Content tab
  'settings.content.rendering': 'Rendering',
  'settings.content.markdown': 'Render Markdown', 'settings.content.rich': 'Render rich text from web pages',
  'settings.content.highlight': 'Syntax highlighting in code', 'settings.content.images': 'Show copied images',
  'settings.content.bidi': 'Direction (BiDi)',
  'settings.content.detect': 'Detection',
  'settings.content.detect.hint': "Majority: a line is RTL when enough of its letters are Hebrew. First letter: the browser's own dir=auto rule.",
  'settings.content.detect.majority': 'Majority', 'settings.content.detect.first': 'First letter',
  'settings.content.ratio': 'Hebrew share for RTL', 'settings.content.ratio.value': '{pct}% of the letters',

  // History tab
  'settings.history.title': 'History & privacy',
  'settings.history.keep': 'Keep history after quit',
  'settings.history.keep.hint': 'Saved only on this Mac. Password-manager items are never shown or saved.',
  'settings.history.size': 'History size',
  'settings.history.ignored': 'Ignore copies from these apps',
  'settings.history.ignored.hint': 'App names or bundle IDs, comma separated (e.g. 1Password, Keychain Access).',
  'settings.history.clear': 'Clear history in all windows', 'settings.history.clear.button': 'Clear',
} });
