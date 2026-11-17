import Cocoa

// MARK: - Log of Text Actions requests
//
// Every action that runs is kept, newest first, in ~/Library/Application Support/Clipboard Monitor/
// actions-history.json (this Mac only, mode 0600), while the "actionsLogKeep" setting is on. An entry is
// {id, time (ms), action, title, query, app, model, source, result | error, ms}. Settings › Text Actions › Log
// shows and searches it.
//
// Page -> native: {cmd: "actionsLog.list"} | {cmd: "actionsLog.delete", id} | {cmd: "actionsLog.clear"}
// Native -> page: monitor.actionsLog({items}) to every window after any change.

@MainActor
enum ActionLog {
    static let limit = 500
    static let url = AppDelegate.supportDir.appendingPathComponent("actions-history.json")
    private static var cache: [[String: Any]]?

    static func all() -> [[String: Any]] {
        if let cache { return cache }
        var items: [[String: Any]] = []
        if let data = try? Data(contentsOf: url), let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] {
            items = arr
        }
        cache = items
        return items
    }

    private static func save(_ items: [[String: Any]]) {
        cache = items
        if items.isEmpty { try? FileManager.default.removeItem(at: url); return }
        guard let data = try? JSONSerialization.data(withJSONObject: items) else { return }
        try? data.write(to: url, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    static func add(_ entry: [String: Any]) {
        guard Settings.bool("actionsLogKeep") else { return }
        var e = entry
        e["id"] = UUID().uuidString
        e["time"] = (Date().timeIntervalSince1970 * 1000).rounded()
        save(Array(([e] + all()).prefix(limit)))
        broadcast()
    }

    static func broadcast() {
        guard let app = NSApp.delegate as? AppDelegate else { return }
        let msg: [String: Any] = ["items": all()]
        app.controllers.forEach { $0.call("monitor.actionsLog", msg) }
    }

    static func handle(_ cmd: String, _ body: [String: Any], from c: MonitorController) {
        switch cmd {
        case "actionsLog.list": c.call("monitor.actionsLog", ["items": all()])
        case "actionsLog.delete":
            guard let id = body["id"] as? String else { return }
            save(all().filter { ($0["id"] as? String) != id })
            broadcast()
        case "actionsLog.clear":
            save([])
            broadcast()
        default: break
        }
    }
}
