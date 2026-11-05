import Foundation

// MARK: - Version info shown in Settings › About
//
// Page -> native: {cmd: "version"}; native -> page: monitor.versionInfo(info).
// build.sh writes the values into the bundle's Info.plist (VERSION file, git commit count, commit, build date).
enum AppVersion {
    static func info() -> [String: Any] {
        let i = Bundle.main.infoDictionary ?? [:]
        return [
            "version": i["CFBundleShortVersionString"] as? String ?? "",
            "build": i["CFBundleVersion"] as? String ?? "",
            "commit": i["CMGitCommit"] as? String ?? "",
            "buildDate": i["CMBuildDate"] as? String ?? "",
            "dirty": (i["CMDirty"] as? String) == "1",
            "os": ProcessInfo.processInfo.operatingSystemVersionString,
            "changelog": "",
        ]
    }
}
