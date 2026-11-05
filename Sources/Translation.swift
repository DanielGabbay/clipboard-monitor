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

// MARK: - Line translation (Translation Lens)
//
// Translates many short screen lines at once and keeps them apart: the lens shows each translation on top of its
// own line. Uses the same engine settings as the clipboard translation (LLM with optional Apple fallback, or
// Apple). An empty target means Hebrew <-> English per line.

enum LineResult: Sendable, Equatable {
    case text(String)
    case same               // already in the target language: leave the original visible
    case failed(String)     // error message or code ("unsupported", "notInstalled")
}

@MainActor
enum LineTranslator {
    static let chunkSize = 40

    static func translate(_ lines: [String], target: String) async -> [LineResult] {
        var results = [LineResult](repeating: .failed(""), count: lines.count)
        var pending: [(index: Int, text: String, from: String, to: String)] = []
        for (i, line) in lines.enumerated() {
            let (from, to) = TranslationRouter.languages(line, target: target.isEmpty ? nil : target)
            if primary(from) == primary(to) { results[i] = .same } else { pending.append((i, line, from, to)) }
        }
        guard !pending.isEmpty else { return results }

        let useLLM = Settings.string("translateEngine") == "llm" && Settings.bool("f.ai")
        guard useLLM else {
            for (i, r) in await apple(pending) { results[i] = r }
            return results
        }
        let providerId = Settings.string("translateProvider"), model = Settings.string("translateModel")
        let fallback = Settings.bool("translateFallbackApple")
        var why: String?
        if let p = AIService.shared.provider(providerId) {
            if !p.enabled { why = "AI provider \"\(p.name)\" is turned off" }
            else if model.isEmpty { why = "No AI model chosen for translation" }
        } else {
            why = "No AI provider chosen for translation"
        }
        var appleItems: [(index: Int, text: String, from: String, to: String)] = []
        if let why {
            if fallback { appleItems = pending } else { pending.forEach { results[$0.index] = .failed(why) } }
        } else {
            let byTarget = Dictionary(grouping: pending, by: { $0.to })
            for (to, items) in byTarget {
                for start in stride(from: 0, to: items.count, by: chunkSize) {
                    let chunk = Array(items[start..<min(start + chunkSize, items.count)])
                    do {
                        let out = try await llm(chunk.map { $0.text }, to: to, providerId: providerId, model: model)
                        for (k, item) in chunk.enumerated() { results[item.index] = .text(out[k]) }
                    } catch {
                        if fallback { appleItems += chunk } else { chunk.forEach { results[$0.index] = .failed(error.localizedDescription) } }
                    }
                }
            }
        }
        if !appleItems.isEmpty { for (i, r) in await apple(appleItems) { results[i] = r } }
        return results
    }

    /// "he-IL" -> "he", "zh-Hans" -> "zh".
    private static func primary(_ code: String) -> String {
        String(code.lowercased().split(whereSeparator: { $0 == "-" || $0 == "_" }).first ?? "")
    }

    static func prompt(to: String, count: Int) -> String {
        """
        You are a translation engine. The user sends a JSON array of \(count) strings: lines of text read from a \
        screen, in order. Translate each string into \(TranslationRouter.languageName(to)) on its own.
        Keep the order and the count: never merge, split, drop or add strings. A line may be cut mid-sentence; \
        translate what is there.
        Keep code, URLs, e-mail addresses, file paths, numbers and product names unchanged. A string that is \
        already in the target language stays as it is.
        Reply with only a JSON array of exactly \(count) strings: no Markdown fences, no notes.
        """
    }

    static func llm(_ texts: [String], to: String, providerId: String, model: String) async throws -> [String] {
        let json = String(decoding: try JSONSerialization.data(withJSONObject: texts), as: UTF8.self)
        let out = try await AIService.shared.chat(providerId: providerId, model: model, system: prompt(to: to, count: texts.count),
                                                  user: json, maxTokens: nil, timeout: AITimeout.translate)
        guard let start = out.firstIndex(of: "["), let end = out.lastIndex(of: "]"), start < end,
              let arr = try? JSONSerialization.jsonObject(with: Data(out[start...end].utf8)) as? [Any],
              arr.count == texts.count else {
            throw AIError("The model did not return \(texts.count) lines")
        }
        return arr.map { ($0 as? String) ?? "\($0)" }
    }

    /// On-device translation (macOS 26+), one session per language pair.
    static func apple(_ items: [(index: Int, text: String, from: String, to: String)]) async -> [Int: LineResult] {
        var out: [Int: LineResult] = [:]
        guard #available(macOS 26.0, *) else {
            items.forEach { out[$0.index] = .failed("unsupported") }
            return out
        }
        let byPair = Dictionary(grouping: items, by: { $0.from + ">" + $0.to })
        for group in byPair.values {
            guard let first = group.first else { continue }
            let source = Locale.Language(identifier: first.from), target = Locale.Language(identifier: first.to)
            let status = await LanguageAvailability().status(from: source, to: target)
            guard status == .installed else {
                let code = status == .supported ? "notInstalled" : "unsupported"
                group.forEach { out[$0.index] = .failed(code) }
                continue
            }
            do {
                let session = TranslationSession(installedSource: source, target: target)
                let requests = group.map { TranslationSession.Request(sourceText: $0.text, clientIdentifier: String($0.index)) }
                for r in try await session.translations(from: requests) {
                    if let id = r.clientIdentifier, let i = Int(id) { out[i] = .text(r.targetText) }
                }
            } catch {
                group.forEach { out[$0.index] = .failed(error.localizedDescription) }
            }
        }
        return out
    }
}
