import Foundation

// MARK: - Native UI strings (menus, alerts)
//
// L("key") looks the key up in the table of the resolved UI language and falls back to English, then to the key.
// The Hebrew table lives in Localization+he.swift. Settings "uiLang" is "system" | "he" | "en".
enum Loc {
    static var lang: String {
        let s = Settings.string("uiLang")
        if s == "he" || s == "en" { return s }
        return Locale.preferredLanguages.first?.lowercased().hasPrefix("he") == true ? "he" : "en"
    }

    static let en: [String: String] = [
        "menu.app.about": "About Clipboard Monitor",
        "menu.app.settings": "Settings…",
        "menu.app.loginItem": "Launch at Login",
        "menu.app.hide": "Hide",
        "menu.app.quit": "Quit Clipboard Monitor",
        "menu.file": "File",
        "menu.file.newWindow": "New Window",
        "menu.file.newTab": "New Tab",
        "menu.file.close": "Close",
        "menu.edit": "Edit",
        "menu.edit.copy": "Copy",
        "menu.edit.selectAll": "Select All",
        "menu.edit.copyRtl": "Copy with RTL Marks",
        "menu.view": "View",
        "menu.view.appearance": "Appearance",
        "menu.view.appearance.system": "System",
        "menu.view.appearance.light": "Light",
        "menu.view.appearance.dark": "Dark",
        "menu.view.onTop": "Always on Top",
        "menu.view.allSpaces": "Show on All Desktops",
        "menu.view.pause": "Pause Monitoring",
        "menu.view.hold": "Hold This Item (stop following)",
        "menu.view.raw": "Raw / Rendered",
        "menu.view.history": "History",
        "menu.view.clearHistory": "Clear History",
        "menu.view.zoomIn": "Zoom In",
        "menu.view.zoomOut": "Zoom Out",
        "menu.view.actualSize": "Actual Size",
        "menu.view.snapRight": "Snap to Right Edge",
        "menu.window": "Window",
        "menu.window.showHide": "Show / Hide Monitors",
        "menu.window.minimize": "Minimize",
        "alert.loginItem.title": "Could not change Launch at Login",
    ]

    static func table(_ lang: String) -> [String: String] { lang == "he" ? he : en }
}

func L(_ key: String) -> String { Loc.table(Loc.lang)[key] ?? Loc.en[key] ?? key }
