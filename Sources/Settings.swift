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
        "f.compare": true, "f.linkPreview": true, "f.copyRtl": true, "f.lens": true, "f.bubble": true, "f.actions": true,
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
        // Text Actions (popover on the selected text of any app)
        "actionsHotkey": "ctrl+opt+KeyA",   // recorded shortcut ("off": none); see HotKey.parse
        "actionsButton": true,              // floating button next to a fresh selection
        "menuBarIcon": true,
        "actionsProvider": "",              // empty: the translation model, else the first usable model
        "actionsModel": "",
        "actionsList": "[]",                // the action library, JSON: [{id, name?, icon?, prompt?, replaces?}]; empty: defaults
        "customActions": "[]",              // older custom actions [{id, name, prompt}], read when the library is empty
        "actionsLogKeep": true,             // keep a log of the requests (actions-history.json)
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

/// A global shortcut stored in settings: one of the presets above, or a recorded one written as modifiers and the
/// key's KeyboardEvent.code joined by "+", e.g. "ctrl+opt+KeyA" (modifiers: ctrl, opt, shift, cmd; at least one
/// of ctrl / opt / cmd). "off" and anything unreadable mean no shortcut.
enum HotKey {
    static let codes: [String: Int] = {
        var m: [String: Int] = [
            "Space": kVK_Space, "Enter": kVK_Return, "Tab": kVK_Tab, "Backquote": kVK_ANSI_Grave,
            "Minus": kVK_ANSI_Minus, "Equal": kVK_ANSI_Equal, "BracketLeft": kVK_ANSI_LeftBracket,
            "BracketRight": kVK_ANSI_RightBracket, "Semicolon": kVK_ANSI_Semicolon, "Quote": kVK_ANSI_Quote,
            "Comma": kVK_ANSI_Comma, "Period": kVK_ANSI_Period, "Slash": kVK_ANSI_Slash, "Backslash": kVK_ANSI_Backslash,
            "ArrowLeft": kVK_LeftArrow, "ArrowRight": kVK_RightArrow, "ArrowUp": kVK_UpArrow, "ArrowDown": kVK_DownArrow,
        ]
        let letters: [(String, Int)] = [
            ("A", kVK_ANSI_A), ("B", kVK_ANSI_B), ("C", kVK_ANSI_C), ("D", kVK_ANSI_D), ("E", kVK_ANSI_E), ("F", kVK_ANSI_F),
            ("G", kVK_ANSI_G), ("H", kVK_ANSI_H), ("I", kVK_ANSI_I), ("J", kVK_ANSI_J), ("K", kVK_ANSI_K), ("L", kVK_ANSI_L),
            ("M", kVK_ANSI_M), ("N", kVK_ANSI_N), ("O", kVK_ANSI_O), ("P", kVK_ANSI_P), ("Q", kVK_ANSI_Q), ("R", kVK_ANSI_R),
            ("S", kVK_ANSI_S), ("T", kVK_ANSI_T), ("U", kVK_ANSI_U), ("V", kVK_ANSI_V), ("W", kVK_ANSI_W), ("X", kVK_ANSI_X),
            ("Y", kVK_ANSI_Y), ("Z", kVK_ANSI_Z),
        ]
        for (l, k) in letters { m["Key" + l] = k }
        let digits = [kVK_ANSI_0, kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
        for (i, k) in digits.enumerated() { m["Digit\(i)"] = k }
        let fkeys = [kVK_F1, kVK_F2, kVK_F3, kVK_F4, kVK_F5, kVK_F6, kVK_F7, kVK_F8, kVK_F9, kVK_F10, kVK_F11, kVK_F12]
        for (i, k) in fkeys.enumerated() { m["F\(i + 1)"] = k }
        return m
    }()

    static func parse(_ s: String) -> (key: Int, mods: Int)? {
        if let p = hotKeyPresets[s] ?? lensHotKeyPresets[s] { return p }
        let parts = s.split(separator: "+").map(String.init)
        guard parts.count >= 2, let last = parts.last, let key = codes[last] else { return nil }
        var mods = 0
        for m in parts.dropLast() {
            switch m {
            case "ctrl": mods |= controlKey
            case "opt": mods |= optionKey
            case "shift": mods |= shiftKey
            case "cmd": mods |= cmdKey
            default: return nil
            }
        }
        guard mods & (controlKey | optionKey | cmdKey) != 0 else { return nil }
        return (key, mods)
    }
}
