import Cocoa

// MARK: - AI providers service (stub; the AI backend work replaces this file's body)
//
// Bridge contract (see the plan): page -> native `ai.*` commands, native -> page `monitor.aiState(state)` broadcast
// to every window and `monitor.aiEvent(event)` to the asking window. API keys live only in the Keychain and are
// never sent to the page.
final class AIService {
    static let shared = AIService()

    /// Called once at launch (auto model refresh etc.).
    func start() {}

    /// The state every window shows: {providers: [...], presets: [...]}. No secrets.
    func stateForPage() -> [String: Any] { ["providers": [], "presets": []] }

    func handle(_ cmd: String, _ body: [String: Any], from c: MonitorController) {
        switch cmd {
        case "ai.list": c.call("monitor.aiState", stateForPage())
        default: break
        }
    }

    func broadcastState() {
        guard let app = NSApp.delegate as? AppDelegate else { return }
        let s = stateForPage()
        app.controllers.forEach { $0.call("monitor.aiState", s) }
    }
}
