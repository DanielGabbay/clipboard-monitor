import Cocoa

// MARK: - Version info shown in Settings › About and in the standard About panel
//
// Page -> native: {cmd: "version"}; native -> page: monitor.versionInfo(info).
// build.sh writes the values into the bundle's Info.plist: CFBundleShortVersionString (VERSION file),
// CFBundleVersion (git commit count), CMGitCommit, CMBuildDate (ISO 8601 UTC), CMDirty ("1" = uncommitted changes).
enum AppVersion {
    private static var plist: [String: Any] { Bundle.main.infoDictionary ?? [:] }

    static var version: String { plist["CFBundleShortVersionString"] as? String ?? "" }
    static var build: String { plist["CFBundleVersion"] as? String ?? "" }
    static var commit: String { plist["CMGitCommit"] as? String ?? "" }
    static var buildDate: String { plist["CMBuildDate"] as? String ?? "" }
    static var dirty: Bool { (plist["CMDirty"] as? String) == "1" }

    /// Contents of the bundled CHANGELOG.md ("" when missing).
    static var changelog: String {
        guard let url = Bundle.main.url(forResource: "CHANGELOG", withExtension: "md"),
              let s = try? String(contentsOf: url, encoding: .utf8) else { return "" }
        return s
    }

    static func info() -> [String: Any] {
        [
            "version": version,
            "build": build,
            "commit": commit,
            "buildDate": buildDate,
            "dirty": dirty,
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "changelog": changelog,
        ]
    }

    /// "1.1.0 (42) · a1b2c3d" (+ " modified" for a build with uncommitted changes). Strings here are inline he/en so
    /// this file does not depend on the shared Localization tables.
    static var displayVersion: String {
        var s = build.isEmpty ? version : "\(version) (\(build))"
        if !commit.isEmpty { s += " · \(commit)\(dirty ? (Loc.lang == "he" ? " שונה" : " modified") : "")" }
        return s
    }

    /// The standard macOS About panel with the version, build and commit.
    static func showAboutPanel() {
        var options: [NSApplication.AboutPanelOptionKey: Any] = [
            .applicationVersion: displayVersion,
            // An empty "Version" hides the parenthesized CFBundleVersion the panel would add on its own.
            NSApplication.AboutPanelOptionKey(rawValue: "Version"): "",
        ]
        if let d = ISO8601DateFormatter().date(from: buildDate) {
            let he = Loc.lang == "he"
            let f = DateFormatter(); f.dateStyle = .medium; f.timeStyle = .short
            f.locale = Locale(identifier: he ? "he_IL" : "en_US")
            let style = NSMutableParagraphStyle(); style.alignment = .center
            options[.credits] = NSAttributedString(string: (he ? "נבנה ב-" : "Built ") + f.string(from: d), attributes: [
                .font: NSFont.systemFont(ofSize: NSFont.smallSystemFontSize),
                .foregroundColor: NSColor.secondaryLabelColor,
                .paragraphStyle: style,
            ])
        }
        NSApp.activate(ignoringOtherApps: true)
        NSApp.orderFrontStandardAboutPanel(options: options)
    }

    /// Menu target: `add(app, L("menu.app.about"), #selector(AboutTarget.showAbout(_:)), "", target: AppVersion.aboutTarget)`.
    static let aboutTarget = AboutTarget()
    final class AboutTarget: NSObject {
        @objc func showAbout(_ sender: Any?) { AppVersion.showAboutPanel() }
    }
}
