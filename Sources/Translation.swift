import Foundation
import Translation

// MARK: - Translation router
//
// Page -> native: {cmd: "translate", text, req, target?}   (empty target = automatic Hebrew <-> English)
// Native -> page: monitor.translated({req, from, to, text | error, engine: "apple" | "llm", model?})
//
// Phase 0: only the on-device Apple engine. The LLM engine (Settings "translateEngine" == "llm") and Apple
// translation to any target language are added by the AI backend work.
enum TranslationRouter {
    static func translate(_ text: String, req: String, target: String?, for c: MonitorController) {
        AppleTranslator.translate(text, req: req, target: target, for: c)
    }

    /// Automatic pair: Hebrew text goes to English, anything else goes to Hebrew.
    static func autoPair(_ text: String) -> (from: String, to: String) {
        let hebrew = text.unicodeScalars.filter { (0x0590...0x05FF).contains($0.value) }.count
        let latin = text.unicodeScalars.filter { CharacterSet.letters.contains($0) && $0.value < 0x0250 }.count
        return hebrew >= latin ? ("he", "en") : ("en", "he")
    }
}

// MARK: - On-device translation (Apple Translation framework, macOS 26+)

enum AppleTranslator {
    /// Translates line by line, so Markdown structure and code fences survive.
    static func translate(_ text: String, req: String, target: String?, for c: MonitorController) {
        let auto = TranslationRouter.autoPair(text)
        let to = (target?.isEmpty == false) ? target! : auto.to
        let from = (to == auto.to) ? auto.from : (to == "he" ? "en" : auto.from)
        let source = Locale.Language(identifier: from)
        let targetLang = Locale.Language(identifier: to)
        let pair: [String: Any] = ["from": from, "to": to, "engine": "apple"]
        func reply(_ extra: [String: Any]) { c.call("monitor.translated", ["req": req].merging(pair) { a, _ in a }.merging(extra) { a, _ in a }) }

        guard #available(macOS 26.0, *) else { reply(["error": "unsupported"]); return }
        Task { @MainActor in
            let status = await LanguageAvailability().status(from: source, to: targetLang)
            guard status == .installed else { reply(["error": status == .supported ? "notInstalled" : "unsupported"]); return }
            do {
                let session = TranslationSession(installedSource: source, target: targetLang)
                // Translate only prose lines; keep fences, blank lines and Markdown prefixes as they are.
                var lines = text.components(separatedBy: "\n")
                var inFence = false
                var requests: [TranslationSession.Request] = []
                var prefixes: [String: String] = [:]
                let prefixRE = try NSRegularExpression(pattern: "^(\\s*(?:[-*+]\\s+(?:\\[[ xX]\\]\\s+)?|\\d+[.)]\\s+|>\\s*|#{1,6}\\s+)*)")
                for (i, line) in lines.enumerated() {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    if trimmed.hasPrefix("```") || trimmed.hasPrefix("~~~") { inFence.toggle(); continue }
                    if inFence || trimmed.isEmpty || !trimmed.contains(where: { $0.isLetter }) { continue }
                    let ns = line as NSString
                    let m = prefixRE.firstMatch(in: line, range: NSRange(location: 0, length: ns.length))
                    let pre = m.map { ns.substring(with: $0.range) } ?? ""
                    let body = ns.substring(from: pre.utf16.count)
                    prefixes[String(i)] = pre
                    requests.append(.init(sourceText: body, clientIdentifier: String(i)))
                }
                for r in try await session.translations(from: requests) {
                    if let id = r.clientIdentifier, let i = Int(id) { lines[i] = (prefixes[id] ?? "") + r.targetText }
                }
                reply(["text": lines.joined(separator: "\n")])
            } catch {
                reply(["error": error.localizedDescription])
            }
        }
    }
}
