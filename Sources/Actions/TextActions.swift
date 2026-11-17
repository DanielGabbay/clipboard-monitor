import Foundation

// MARK: - Text Actions: what can be done to selected text
//
// Built-in actions are named by the page (Resources/actions.js); custom ones carry their own name and prompt and
// live in the "customActions" setting as a JSON array of {id, name, prompt}. "translate:<code>" translates with
// the translation settings (Apple on-device or the chosen model), so it works without an AI provider. Text typed
// in the popover's search field that matches no action runs as a free instruction ("ask").

struct ActionFailure: LocalizedError, Sendable {
    /// "noModel" (the page offers the AI settings) or "" for a plain message.
    let code: String
    let message: String
    var errorDescription: String? { message }
}

@MainActor
enum TextActions {
    static let outputRule = """
    Output only the result: no preface, no notes, no surrounding quotes. Keep the line breaks and any Markdown, \
    code, URLs and names as they are.
    """

    static let builtIn: [(id: String, prompt: String)] = [
        ("improve", "Rewrite the user's text so it reads clearly and naturally. Keep its meaning, tone and language."),
        ("fix", "Correct the spelling, grammar and punctuation of the user's text. Change nothing else: keep the wording, tone and language."),
        ("simplify", "Rewrite the user's text in simpler, plainer words. Keep its meaning and language."),
        ("paraphrase", "Say the same thing as the user's text in different words. Keep its meaning, length and language."),
        ("summarize", "Summarize the user's text in a few short sentences, in the language of the text."),
        ("explain", "Explain in plain words what the user's text means."),
    ]

    /// Actions whose result is a new version of the text, so "Replace" is the main button.
    static let rewrites: Set<String> = ["improve", "fix", "simplify", "paraphrase"]

    static func custom() -> [(id: String, name: String, prompt: String)] {
        guard let data = Settings.string("customActions").data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return arr.compactMap { d in
            guard let id = d["id"] as? String, let name = (d["name"] as? String)?.trimmingCharacters(in: .whitespaces),
                  let prompt = (d["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines),
                  !name.isEmpty, !prompt.isEmpty else { return nil }
            return (id, name, prompt)
        }
    }

    /// The list the popover shows, in order: built-in, translate targets, custom.
    static func listForPage() -> [[String: Any]] {
        var out: [[String: Any]] = builtIn.map { ["id": $0.id, "kind": "builtin", "replaces": rewrites.contains($0.id)] }
        let targets = Settings.string("translateTargets").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        out += targets.map { ["id": "translate:" + $0, "kind": "translate", "lang": $0, "replaces": true] }
        out += custom().map { ["id": "custom:" + $0.id, "kind": "custom", "title": $0.name, "replaces": true] }
        return out
    }

    // MARK: model

    private static func usable(_ providerId: String, _ model: String) -> Bool {
        guard let p = AIService.shared.provider(providerId), p.enabled else { return false }
        return p.models.contains { $0.id == model && !$0.hidden && !$0.missing }
    }

    /// The chosen model, else the translation model, else the first usable one.
    static func model() -> (providerId: String, model: String)? {
        guard Settings.bool("f.ai") else { return nil }
        let choices = [(Settings.string("actionsProvider"), Settings.string("actionsModel")),
                       (Settings.string("translateProvider"), Settings.string("translateModel"))]
        for (p, m) in choices where !m.isEmpty && usable(p, m) { return (p, m) }
        for p in AIService.shared.providers where p.enabled {
            if let m = p.models.first(where: { !$0.hidden && !$0.missing }) { return (p.id, m.id) }
        }
        return nil
    }

    /// Enabled providers' visible models, for the popover's picker: [{value, label, group}].
    static func modelsForPage() -> [[String: String]] {
        guard Settings.bool("f.ai") else { return [] }
        var out: [[String: String]] = []
        for p in AIService.shared.providers where p.enabled {
            for m in p.models where !m.hidden && !m.missing {
                out.append(["value": p.id + "\n" + m.id, "label": m.label ?? m.id, "group": p.name.isEmpty ? p.id : p.name])
            }
        }
        return out
    }

    // MARK: run

    static func run(id: String, query: String?, text: String) async throws -> String {
        if id.hasPrefix("translate:") { return try await translate(text, to: String(id.dropFirst("translate:".count))) }
        let system: String, user: String
        if id == "ask" {
            guard let q = query?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty else {
                throw ActionFailure(code: "", message: "Type what to do with the text")
            }
            system = "The user gives an instruction and a text. Apply the instruction to the text. " + outputRule
            user = "Instruction: \(q)\n\nText:\n\(text)"
        } else if id.hasPrefix("custom:"), let c = custom().first(where: { "custom:" + $0.id == id }) {
            system = c.prompt + "\n" + outputRule
            user = text
        } else if let b = builtIn.first(where: { $0.id == id }) {
            var p = b.prompt
            if id == "explain" { p += " Answer in \(TranslationRouter.languageName(Loc.lang))." }
            system = p + " " + outputRule
            user = text
        } else {
            throw ActionFailure(code: "", message: "Unknown action")
        }
        guard let m = model() else { throw ActionFailure(code: "noModel", message: "No AI model is set up") }
        let out = try await AIService.shared.chat(providerId: m.providerId, model: m.model, system: system, user: user,
                                                  maxTokens: nil, timeout: AITimeout.action)
        let result = out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.isEmpty else { throw ActionFailure(code: "", message: "The model returned an empty answer") }
        return result
    }

    /// Translates line by line so the text keeps its paragraphs; lines already in the target language stay.
    private static func translate(_ text: String, to code: String) async throws -> String {
        var lines = text.components(separatedBy: "\n")
        let filled = lines.indices.filter { !lines[$0].trimmingCharacters(in: .whitespaces).isEmpty }
        let results = await LineTranslator.translate(filled.map { lines[$0] }, target: code)
        var translated = 0, same = 0, failure: String?
        for (k, i) in filled.enumerated() {
            switch results[k] {
            case .text(let t): lines[i] = t; translated += 1
            case .same: same += 1
            case .failed(let why): if failure == nil { failure = why }
            }
        }
        if translated == 0, let failure { throw ActionFailure(code: failure, message: failure) }
        if translated == 0, same > 0 { throw ActionFailure(code: "sameLanguage", message: "Already in this language") }
        return lines.joined(separator: "\n")
    }
}
