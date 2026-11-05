import Foundation
import NaturalLanguage
import Translation

// MARK: - Translation router
//
// Page -> native: {cmd: "translate", text, req, target?}   (empty target = automatic Hebrew <-> English)
// Native -> page: monitor.translated({req, from, to, text | error, engine: "apple" | "llm", model?, provider?,
//                                     fallbackFrom?})
//
// Settings "translateEngine" == "llm" (with the AI feature on) sends the whole text to the chosen provider and
// model; when that fails and "translateFallbackApple" is on, the on-device Apple engine answers instead and the
// reply carries `fallbackFrom` with the LLM error.
@MainActor
enum TranslationRouter {
    static func translate(_ text: String, req: String, target: String?, for c: MonitorController) {
        let (from, to) = languages(text, target: target)
        guard Settings.string("translateEngine") == "llm", Settings.bool("f.ai") else {
            AppleTranslator.translate(text, req: req, target: target, for: c)
            return
        }
        let providerId = Settings.string("translateProvider"), model = Settings.string("translateModel")
        let fallback = Settings.bool("translateFallbackApple")
        var why: String?
        if let p = AIService.shared.provider(providerId) {
            if !p.enabled { why = "AI provider \"\(p.name)\" is turned off" }
            else if !p.models.contains(where: { $0.id == model }) { why = model.isEmpty ? "No AI model chosen for translation" : "Model \(model) not found" }
        } else {
            why = "No AI provider chosen for translation"
        }
        if let why {
            if fallback { AppleTranslator.translate(text, req: req, target: target, for: c, extra: ["fallbackFrom": why]) }
            else { c.call("monitor.translated", ["req": req, "from": from, "to": to, "engine": "llm", "model": model, "error": why]) }
            return
        }
        let providerName = AIService.shared.provider(providerId)?.name ?? ""
        let base: [String: Any] = ["req": req, "from": from, "to": to, "engine": "llm", "model": model, "provider": providerName]
        Task { [weak c] in
            do {
                let out = try await AIService.shared.chat(providerId: providerId, model: model, system: systemPrompt(to: to),
                                                          user: text, maxTokens: nil, timeout: AITimeout.translate)
                let result = out.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !result.isEmpty else { throw AIError("The model returned an empty answer") }
                c?.call("monitor.translated", base.merging(["text": result]) { _, b in b })
            } catch {
                guard let c else { return }
                if fallback {
                    AppleTranslator.translate(text, req: req, target: target, for: c, extra: ["fallbackFrom": error.localizedDescription])
                } else {
                    c.call("monitor.translated", base.merging(["error": error.localizedDescription]) { _, b in b })
                }
            }
        }
    }

    static func systemPrompt(to: String) -> String {
        let lang = languageName(to)
        return """
        You are a translation engine. Translate the user's text into \(lang).
        Keep the Markdown structure exactly as it is: headings, lists, tables, quotes, emphasis, links and line breaks.
        Never translate or change code blocks, inline code, URLs, e-mail addresses or file paths; copy them unchanged.
        Output only the translation, with no preface, notes, explanations or surrounding quotes.
        """
    }

    /// English name of a language code ("he" -> "Hebrew"), for the LLM prompt.
    static func languageName(_ code: String) -> String {
        Locale(identifier: "en").localizedString(forIdentifier: code) ?? code
    }

    /// Automatic pair: Hebrew text goes to English, anything else goes to Hebrew.
    static func autoPair(_ text: String) -> (from: String, to: String) {
        let hebrew = text.unicodeScalars.filter { (0x0590...0x05FF).contains($0.value) }.count
        let latin = text.unicodeScalars.filter { CharacterSet.letters.contains($0) && $0.value < 0x0250 }.count
        return hebrew >= latin ? ("he", "en") : ("en", "he")
    }

    /// Dominant language of the text (ISO code such as "he", "en", "fr"), or nil when unsure.
    static func detect(_ text: String) -> String? {
        let r = NLLanguageRecognizer()
        r.processString(String(text.prefix(4000)))
        guard let (lang, p) = r.languageHypotheses(withMaximum: 1).first, p >= 0.3, lang != .undetermined else { return nil }
        return lang.rawValue
    }

    /// Source and target codes. Empty target: the he <-> en pair decides the target; the source is the detected
    /// language when it is neither Hebrew nor English (e.g. French -> Hebrew, Arabic -> English).
    static func languages(_ text: String, target: String?) -> (from: String, to: String) {
        let auto = autoPair(text)
        let detected = detect(text)
        if let t = target?.trimmingCharacters(in: .whitespaces), !t.isEmpty { return (detected ?? auto.from, t) }
        if let d = detected, d != "he", d != "en" { return (d, auto.to) }
        return auto
    }
}

// MARK: - On-device translation (Apple Translation framework, macOS 26+)

@MainActor
enum AppleTranslator {
    /// Translates line by line, so Markdown structure and code fences survive. `extra` is merged into the reply
    /// (the router passes `fallbackFrom`).
    static func translate(_ text: String, req: String, target: String?, for c: MonitorController, extra: [String: Any] = [:]) {
        let (from, to) = TranslationRouter.languages(text, target: target)
        let source = Locale.Language(identifier: from)
        let targetLang = Locale.Language(identifier: to)
        let pair: [String: Any] = ["from": from, "to": to, "engine": "apple"]
        func reply(_ result: [String: Any]) {
            c.call("monitor.translated", ["req": req].merging(pair) { a, _ in a }.merging(extra) { a, _ in a }.merging(result) { a, _ in a })
        }

        // Already in the target language: nothing to translate.
        if source.minimalIdentifier == targetLang.minimalIdentifier { reply(["text": text]); return }
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
