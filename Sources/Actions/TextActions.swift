import Cocoa

// MARK: - Text Actions: what can be done to selected text
//
// The action library is the "actionsList" setting: a JSON array of {id, name?, icon?, prompt?, replaces?}, in the
// order the popover shows. An empty list means the defaults below. Built-in ids keep their localized name (the
// page names them) and default prompt until the user changes them; any other id is the user's own action.
// Actions made before the library existed ("customActions") are added to the defaults.
//
// Prompt placeholders, written {{ NAME }} (case and spaces do not matter):
//   SELECTED TEXT  the selection. Without it the selection is sent on its own, after the prompt.
//   CLIPBOARD      the text on the clipboard        APP    the app the text came from
//   LANGUAGE       the interface language            DATE / TIME   now
//
// "translate:<code>" translates with the translation settings (Apple on-device or the chosen model), so it works
// without an AI provider. Text typed in the popover's search field that matches no action runs as a free
// instruction ("ask").

struct ActionFailure: LocalizedError, Sendable {
    /// "noModel" (the page offers the AI settings), "sameLanguage", a translation error code, or "".
    let code: String
    let message: String
    var errorDescription: String? { message }
}

struct ActionDef: Sendable {
    let id: String
    /// nil: a built-in action that still has its localized name.
    let name: String?
    let icon: String
    let prompt: String
    /// The result is a new version of the text, so "Replace" is the main button.
    let replaces: Bool
}

struct ActionResult: Sendable {
    let text: String
    /// "provider / model" for the log; empty when no model was involved (Apple translation).
    let model: String
}

@MainActor
enum TextActions {
    static let outputRule = """
    Output only the result: no preface, no notes, no surrounding quotes. Keep the line breaks and any Markdown, \
    code, URLs and names as they are.
    """

    static let defaults: [ActionDef] = [
        ActionDef(id: "improve", name: nil, icon: "improve", prompt: "Rewrite the user's text so it reads clearly and naturally. Keep its meaning, tone and language.", replaces: true),
        ActionDef(id: "fix", name: nil, icon: "fix", prompt: "Correct the spelling, grammar and punctuation of the user's text. Change nothing else: keep the wording, tone and language.", replaces: true),
        ActionDef(id: "simplify", name: nil, icon: "simplify", prompt: "Rewrite the user's text in simpler, plainer words. Keep its meaning and language.", replaces: true),
        ActionDef(id: "paraphrase", name: nil, icon: "paraphrase", prompt: "Say the same thing as the user's text in different words. Keep its meaning, length and language.", replaces: true),
        ActionDef(id: "summarize", name: nil, icon: "summarize", prompt: "Summarize the user's text in a few short sentences, in the language of the text.", replaces: false),
        ActionDef(id: "explain", name: nil, icon: "explain", prompt: "Explain in plain words what the user's text means. Answer in {{ LANGUAGE }}.", replaces: false),
    ]

    private static func json(_ key: String) -> [[String: Any]] {
        guard let data = Settings.string(key).data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return arr
    }

    /// The actions in popover order: the saved library, else the defaults plus older custom actions.
    static func library() -> [ActionDef] {
        let saved = json("actionsList")
        guard !saved.isEmpty else {
            let old = json("customActions").compactMap { d -> ActionDef? in
                guard let id = d["id"] as? String else { return nil }
                return ActionDef(id: "custom:" + id, name: d["name"] as? String ?? "", icon: "custom",
                                 prompt: d["prompt"] as? String ?? "", replaces: true)
            }
            return defaults + old
        }
        return saved.compactMap { d in
            guard let id = d["id"] as? String, !id.isEmpty, id != "ask", !id.hasPrefix("translate:") else { return nil }
            let base = defaults.first { $0.id == id }
            let name = (d["name"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
            let prompt = (d["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return ActionDef(id: id, name: name.isEmpty ? (base == nil ? "" : nil) : name,
                             icon: (d["icon"] as? String) ?? base?.icon ?? "custom",
                             prompt: prompt.isEmpty ? (base?.prompt ?? "") : prompt,
                             replaces: (d["replaces"] as? Bool) ?? base?.replaces ?? true)
        }
    }

    private static func dict(_ a: ActionDef) -> [String: Any] {
        ["id": a.id, "name": a.name ?? "", "icon": a.icon, "prompt": a.prompt, "replaces": a.replaces,
         "builtin": defaults.contains { $0.id == a.id }]
    }

    /// The whole library for the settings editor, and the built-in defaults for "restore".
    static func libraryForPage() -> [[String: Any]] { library().map(dict) }
    static func defaultsForPage() -> [[String: Any]] { defaults.map(dict) }

    /// The list the popover shows: usable library actions, then the translate targets.
    static func listForPage() -> [[String: Any]] {
        var out: [[String: Any]] = library().filter { $0.name != "" && !$0.prompt.isEmpty }.map {
            ["id": $0.id, "kind": $0.name == nil ? "builtin" : "custom", "title": $0.name ?? "", "icon": $0.icon, "replaces": $0.replaces]
        }
        let targets = Settings.string("translateTargets").split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        out += targets.map { ["id": "translate:" + $0, "kind": "translate", "lang": $0, "icon": "translate", "replaces": true] }
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

    // MARK: prompt

    private static func pattern(_ name: String) -> NSRegularExpression? {
        let words = name.split(separator: " ").map { NSRegularExpression.escapedPattern(for: String($0)) }.joined(separator: "\\s+")
        return try? NSRegularExpression(pattern: "\\{\\{\\s*" + words + "\\s*\\}\\}", options: .caseInsensitive)
    }

    private static func has(_ name: String, in s: String) -> Bool {
        pattern(name)?.firstMatch(in: s, range: NSRange(s.startIndex..., in: s)) != nil
    }

    private static func fill(_ name: String, with value: String, in s: String) -> String {
        guard let re = pattern(name) else { return s }
        return re.stringByReplacingMatches(in: s, range: NSRange(s.startIndex..., in: s),
                                           withTemplate: NSRegularExpression.escapedTemplate(for: value))
    }

    /// The system and user messages for a prompt. A prompt that places the selection itself is sent whole as the
    /// user message; otherwise the prompt is the instruction and the selection is the message.
    static func compose(_ prompt: String, text: String, app: String?) -> (system: String, user: String) {
        var p = prompt
        if has("CLIPBOARD", in: p) { p = fill("CLIPBOARD", with: NSPasteboard.general.string(forType: .string) ?? "", in: p) }
        p = fill("APP", with: app ?? "", in: p)
        p = fill("LANGUAGE", with: TranslationRouter.languageName(Loc.lang), in: p)
        let now = Date()
        p = fill("DATE", with: DateFormatter.localizedString(from: now, dateStyle: .long, timeStyle: .none), in: p)
        p = fill("TIME", with: DateFormatter.localizedString(from: now, dateStyle: .none, timeStyle: .short), in: p)
        if has("SELECTED TEXT", in: p) { return (outputRule, fill("SELECTED TEXT", with: text, in: p)) }
        return (p + "\n" + outputRule, text)
    }

    // MARK: run

    static func run(id: String, query: String?, text: String, app: String?) async throws -> ActionResult {
        if id.hasPrefix("translate:") {
            return ActionResult(text: try await translate(text, to: String(id.dropFirst("translate:".count))), model: "")
        }
        let system: String, user: String
        if id == "ask" {
            guard let q = query?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty else {
                throw ActionFailure(code: "", message: "Type what to do with the text")
            }
            system = "The user gives an instruction and a text. Apply the instruction to the text. " + outputRule
            user = "Instruction: \(q)\n\nText:\n\(text)"
        } else if let a = library().first(where: { $0.id == id }), !a.prompt.isEmpty {
            (system, user) = compose(a.prompt, text: text, app: app)
        } else {
            throw ActionFailure(code: "", message: "Unknown action")
        }
        guard let m = model() else { throw ActionFailure(code: "noModel", message: "No AI model is set up") }
        let out = try await AIService.shared.chat(providerId: m.providerId, model: m.model, system: system, user: user,
                                                  maxTokens: nil, timeout: AITimeout.action)
        let result = out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.isEmpty else { throw ActionFailure(code: "", message: "The model returned an empty answer") }
        let provider = AIService.shared.provider(m.providerId)?.name ?? ""
        return ActionResult(text: result, model: provider.isEmpty ? m.model : provider + " / " + m.model)
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
