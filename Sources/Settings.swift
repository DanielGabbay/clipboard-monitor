import Cocoa
import Carbon

// MARK: - Settings

/// Every setting lives in UserDefaults as "s.<key>". The page sees the whole dictionary; keys it does not
/// know about are native-only. Older builds stored a few keys without the prefix; those are still honoured.
/// Only keys listed in `defaults` can be set from the page.
enum Settings {
    static let d = UserDefaults.standard
    static let defaults: [String: Any] = [
        // window & app
        "onTop": false, "allSpaces": false, "theme": "system", "zoom": 1.0, "hotkey": "ctrl-opt-v",
        "uiLang": "system",                 // "system" | "he" | "en"
        // history & privacy
        "keepHistory": true, "maxHistory": 50, "ignoredApps": "",
        // rendering (used by the page)
        "detect": "majority", "ratio": 0.3, "rich": true, "markdown": true, "highlight": true, "images": true,
        "font": "system",
        // features (flat "f.*" keys so the generic set path covers them)
        "f.translate": true, "f.ai": true, "f.smartCards": true,
        "f.smartJwt": true, "f.smartJson": true, "f.smartColor": true, "f.smartTime": true, "f.smartBase64": true, "f.smartLink": true,
        "f.compare": true, "f.linkPreview": true, "f.copyRtl": true, "f.lens": true, "f.bubble": true,
        // translation
        "translateEngine": "apple",         // "apple" | "llm"
        "translateProvider": "",            // AI provider id
        "translateModel": "",               // model id within that provider
        "translateFallbackApple": true,
        "translateTargets": "he,en,ar,ru,fr,es,de",
        // Translate at Pointer (bubble) and Translation Lens (reading panel); they share the target language
        "lensTarget": "",                   // empty: Hebrew <-> English per paragraph
        "lensAutoRefresh": true,
        "lensMode": "reading",              // "reading" (translated document) | "overlay" (boxes over each line)
        "lensHotkey": "ctrl-opt-cmd-t",
        "bubbleHotkey": "ctrl-opt-t",
        // AI
        "modelRefreshHours": 24,
    ]
    static func get(_ k: String) -> Any { d.object(forKey: "s." + k) ?? d.object(forKey: k) ?? defaults[k] ?? NSNull() }
    static func set(_ k: String, _ v: Any) { d.set(v, forKey: "s." + k) }
    static func bool(_ k: String) -> Bool { (get(k) as? NSNumber)?.boolValue ?? false }
    static func double(_ k: String) -> Double { (get(k) as? NSNumber)?.doubleValue ?? 0 }
    static func string(_ k: String) -> String { get(k) as? String ?? "" }
    static var all: [String: Any] { var r: [String: Any] = [:]; for k in defaults.keys { r[k] = get(k) }; return r }
}

/// Global show/hide shortcuts offered in Settings. Carbon hot keys need no Accessibility permission.
let hotKeyPresets: [String: (key: Int, mods: Int)] = [
    "ctrl-opt-v": (kVK_ANSI_V, controlKey | optionKey),
    "ctrl-opt-cmd-v": (kVK_ANSI_V, controlKey | optionKey | cmdKey),
    "ctrl-shift-v": (kVK_ANSI_V, controlKey | shiftKey),
    "ctrl-opt-space": (kVK_Space, controlKey | optionKey),
]

/// Global shortcuts for Translate at Pointer and the Translation Lens (one preset list for both).
let lensHotKeyPresets: [String: (key: Int, mods: Int)] = [
    "ctrl-opt-t": (kVK_ANSI_T, controlKey | optionKey),
    "ctrl-opt-cmd-t": (kVK_ANSI_T, controlKey | optionKey | cmdKey),
    "ctrl-shift-t": (kVK_ANSI_T, controlKey | shiftKey),
]
