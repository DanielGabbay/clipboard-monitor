import Cocoa

// MARK: - Text Actions: what can be done to selected text
//
// The action library is the "actionsList" setting: a JSON array of {id, name?, icon?, prompt?, replaces?}, in the
// order the popover shows. An empty list means the defaults below. Built-in ids keep their localized name (the
// page names them) and default prompt until the user changes them; any other id is the user's own action.
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

    static let localIds: Set<String> = ["flipKeyboard", "wrapRtl", "cleanSpaces"]
    static func isLocal(_ id: String) -> Bool { localIds.contains(id) }

    static let validIcons: Set<String> = [
        "improve", "fix", "simplify", "paraphrase", "summarize", "explain", "translate",
        "custom", "chat", "mail", "doc", "idea", "list", "code", "quote", "tag",
    ]

    static let defaults: [ActionDef] = [
        ActionDef(id: "improve", name: nil, icon: "improve", prompt: "Rewrite the user's text so it reads clearly and naturally. Keep its meaning, tone and language.", replaces: true),
        ActionDef(id: "fix", name: nil, icon: "fix", prompt: "Correct the spelling, grammar and punctuation of the user's text. Change nothing else: keep the wording, tone and language.", replaces: true),
        ActionDef(id: "simplify", name: nil, icon: "simplify", prompt: "Rewrite the user's text in simpler, plainer words. Keep its meaning and language.", replaces: true),
        ActionDef(id: "paraphrase", name: nil, icon: "paraphrase", prompt: "Say the same thing as the user's text in different words. Keep its meaning, length and language.", replaces: true),
        ActionDef(id: "summarize", name: nil, icon: "summarize", prompt: "Summarize the user's text in a few short sentences, in the language of the text.", replaces: false),
        ActionDef(id: "explain", name: nil, icon: "explain", prompt: "Explain in plain words what the user's text means. Answer in {{ LANGUAGE }}.", replaces: false),
        ActionDef(id: "flipKeyboard", name: nil, icon: "flipKeyboard", prompt: "", replaces: true),
        ActionDef(id: "wrapRtl", name: nil, icon: "wrapRtl", prompt: "", replaces: true),
        ActionDef(id: "cleanSpaces", name: nil, icon: "cleanSpaces", prompt: "", replaces: true),
    ]

    private static func json(_ key: String) -> [[String: Any]] {
        guard let data = Settings.string(key).data(using: .utf8),
              let arr = (try? JSONSerialization.jsonObject(with: data)) as? [[String: Any]] else { return [] }
        return arr
    }

    /// The actions in popover order: the saved library, else the defaults.
    static func library() -> [ActionDef] {
        let saved = json("actionsList")
        guard !saved.isEmpty else { return defaults }
        return saved.compactMap { d in
            guard let id = d["id"] as? String, !id.isEmpty, id != "ask", !id.hasPrefix("translate:") else { return nil }
            let base = defaults.first { $0.id == id }
            let name = (d["name"] as? String)?.trimmingCharacters(in: .whitespaces) ?? ""
            let prompt = (d["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return ActionDef(id: id, name: name.isEmpty ? (base == nil ? "" : nil) : name,
                             icon: (d["icon"] as? String) ?? base?.icon ?? "custom",
                             prompt: isLocal(id) ? "" : (prompt.isEmpty ? (base?.prompt ?? "") : prompt),
                             replaces: (d["replaces"] as? Bool) ?? base?.replaces ?? true)
        }
    }

    private static func dict(_ a: ActionDef) -> [String: Any] {
        ["id": a.id, "name": a.name ?? "", "icon": a.icon, "prompt": a.prompt, "replaces": a.replaces,
         "builtin": defaults.contains { $0.id == a.id },
         "kind": isLocal(a.id) ? "local" : (a.name == nil ? "builtin" : "custom"),
         "local": isLocal(a.id)]
    }

    /// The whole library for the settings editor, and the built-in defaults for "restore".
    static func libraryForPage() -> [[String: Any]] { library().map(dict) }
    static func defaultsForPage() -> [[String: Any]] { defaults.map(dict) }

    /// The list the popover shows: usable library actions, then the translate targets.
    static func listForPage() -> [[String: Any]] {
        var out: [[String: Any]] = library().filter { $0.name != "" && (isLocal($0.id) || !$0.prompt.isEmpty) }.map {
            ["id": $0.id, "kind": isLocal($0.id) ? "local" : ($0.name == nil ? "builtin" : "custom"),
             "title": $0.name ?? "", "icon": $0.icon, "replaces": $0.replaces]
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

    /// Instant zero-AI local transforms; returns nil when `id` is not a local action.
    static func runLocal(id: String, text: String) -> String? {
        switch id {
        case "flipKeyboard": return TextTransforms.flipKeyboard(text)
        case "wrapRtl": return TextTransforms.wrapRtl(text)
        case "cleanSpaces": return TextTransforms.cleanWhitespace(text)
        default: return nil
        }
    }

    private static func prepareChat(id: String, query: String?, messages: [[String: String]]?, text: String, app: String?)
        throws -> (providerId: String, model: String, modelLabel: String, system: String, messages: [[String: String]]) {
        var cleaned: [[String: String]] = []
        if let messages {
            for msg in messages {
                guard let role = msg["role"], role == "user" || role == "assistant",
                      let content = msg["content"], !content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { continue }
                cleaned.append(["role": role, "content": content])
            }
        }
        let system: String, initialUser: String
        if id == "ask" {
            let q = query?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !q.isEmpty || !cleaned.isEmpty else {
                throw ActionFailure(code: "", message: "Type what to do with the text")
            }
            system = "The user gives an instruction and a text. Apply the instruction to the text. " + outputRule
            initialUser = q.isEmpty ? text : "Instruction: \(q)\n\nText:\n\(text)"
        } else if let a = library().first(where: { $0.id == id }), !a.prompt.isEmpty {
            (system, initialUser) = compose(a.prompt, text: text, app: app)
        } else {
            throw ActionFailure(code: "", message: "Unknown action")
        }
        guard let m = model() else { throw ActionFailure(code: "noModel", message: "No AI model is set up") }
        var normalized: [[String: String]] = []
        if !cleaned.isEmpty {
            if cleaned.first?["role"] != "user" {
                cleaned.insert(["role": "user", "content": initialUser], at: 0)
            }
            for msg in cleaned {
                if let last = normalized.last, last["role"] == msg["role"] {
                    normalized[normalized.count - 1]["content"] = (last["content"] ?? "") + "\n\n" + (msg["content"] ?? "")
                } else {
                    normalized.append(msg)
                }
            }
        } else {
            normalized = [["role": "user", "content": initialUser]]
        }
        let provider = AIService.shared.provider(m.providerId)?.name ?? ""
        let modelLabel = provider.isEmpty ? m.model : provider + " / " + m.model
        return (m.providerId, m.model, modelLabel, system, normalized)
    }

    static func runStream(id: String, query: String?, messages: [[String: String]]?, text: String, app: String?)
        throws -> (stream: AsyncThrowingStream<String, Error>, model: String) {
        let prep = try prepareChat(id: id, query: query, messages: messages, text: text, app: app)
        let stream = AIService.shared.chatStream(providerId: prep.providerId, model: prep.model, system: prep.system,
                                                 messages: prep.messages, maxTokens: nil, timeout: AITimeout.action)
        return (stream, prep.modelLabel)
    }

    static func run(id: String, query: String?, text: String, app: String?) async throws -> ActionResult {
        if let localOut = runLocal(id: id, text: text) {
            return ActionResult(text: localOut, model: "")
        }
        if id.hasPrefix("translate:") {
            return ActionResult(text: try await translate(text, to: String(id.dropFirst("translate:".count))), model: "")
        }
        let prep = try prepareChat(id: id, query: query, messages: nil, text: text, app: app)
        let out = try await AIService.shared.chat(providerId: prep.providerId, model: prep.model, system: prep.system,
                                                  user: prep.messages.first?["content"] ?? text,
                                                  maxTokens: nil, timeout: AITimeout.action)
        let result = out.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !result.isEmpty else { throw ActionFailure(code: "", message: "The model returned an empty answer") }
        return ActionResult(text: result, model: prep.modelLabel)
    }

    // MARK: AI action builder

    private static func scanJSONObject(in text: String) -> [String: Any]? {
        var idx = text.startIndex
        while idx < text.endIndex {
            if text[idx] == "{" {
                var depth = 0
                var inString = false
                var escaped = false
                var j = idx
                while j < text.endIndex {
                    let ch = text[j]
                    if inString {
                        if escaped {
                            escaped = false
                        } else if ch == "\\" {
                            escaped = true
                        } else if ch == "\"" {
                            inString = false
                        }
                    } else {
                        if ch == "\"" {
                            inString = true
                        } else if ch == "{" {
                            depth += 1
                        } else if ch == "}" {
                            depth -= 1
                            if depth == 0 {
                                let slice = String(text[idx...j])
                                if let data = slice.data(using: .utf8),
                                   let obj = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
                                    return obj
                                }
                                break
                            }
                        }
                    }
                    j = text.index(after: j)
                }
            }
            idx = text.index(after: idx)
        }
        return nil
    }

    private static func extractJSONObject(from raw: String) -> [String: Any]? {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let re = try? NSRegularExpression(pattern: "```[^\\n`]*\\r?\\n([\\s\\S]*?)```") {
            let ns = trimmed as NSString
            let matches = re.matches(in: trimmed, range: NSRange(location: 0, length: ns.length))
            for m in matches where m.numberOfRanges > 1 {
                let block = ns.substring(with: m.range(at: 1))
                if let obj = scanJSONObject(in: block) { return obj }
            }
        }
        return scanJSONObject(in: trimmed)
    }

    /// Generates or refines an action definition `{name, icon, prompt, replaces}` from a natural-language request.
    static func generateAction(request: String, existing: [String: Any]? = nil) async throws -> [String: Any] {
        let req = request.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !req.isEmpty else { throw ActionFailure(code: "", message: "Describe the action to create") }
        guard let m = model() else { throw ActionFailure(code: "noModel", message: "No AI model is set up") }
        let system = """
        You design reusable text-transformation actions for a macOS utility.
        Respond with ONLY a single JSON object (no markdown fences, no commentary) with these exact keys:
        - "name": short concise title in the same language as the user's request (2–5 words).
        - "icon": one of: improve, fix, simplify, paraphrase, summarize, explain, translate, custom, chat, mail, doc, idea, list, code, quote, tag.
        - "prompt": clear instruction for an LLM to perform on selected text. Available variables: {{ SELECTED TEXT }}, {{ CLIPBOARD }}, {{ APP }}, {{ LANGUAGE }}, {{ DATE }}, {{ TIME }}. If {{ SELECTED TEXT }} is omitted, the selected text is passed separately as the user message.
        - "replaces": boolean (true if the output is meant to replace the selected text, false if it is an explanation, summary, or commentary).
        """
        var user = "Requested action:\n\(req)"
        if let existing {
            let cleanExisting: [String: Any] = [
                "name": (existing["name"] as? String) ?? "",
                "icon": (existing["icon"] as? String) ?? "custom",
                "prompt": (existing["prompt"] as? String) ?? "",
                "replaces": (existing["replaces"] as? Bool) ?? true,
            ]
            if let data = try? JSONSerialization.data(withJSONObject: cleanExisting),
               let jsonStr = String(data: data, encoding: .utf8) {
                user = "Current action:\n\(jsonStr)\n\nRequested change:\n\(req)"
            }
        }
        let raw = try await AIService.shared.chat(providerId: m.providerId, model: m.model, system: system, user: user,
                                                  maxTokens: 1024, timeout: AITimeout.action)
        guard let obj = extractJSONObject(from: raw),
              let name = (obj["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty,
              let prompt = (obj["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !prompt.isEmpty else {
            throw ActionFailure(code: "", message: "Could not parse the generated action")
        }
        let rawIcon = (obj["icon"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "custom"
        let icon = validIcons.contains(rawIcon) ? rawIcon : "custom"
        let replaces = (obj["replaces"] as? Bool) ?? true
        return ["name": name, "icon": icon, "prompt": prompt, "replaces": replaces]
    }

    /// Saves a generated/custom action into `actionsList` while preserving built-in defaults when `actionsList` was empty.
    @discardableResult
    static func saveCustomAction(_ body: [String: Any]) -> String? {
        let d = (body["action"] as? [String: Any]) ?? body
        let name = (d["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let prompt = (d["prompt"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !name.isEmpty, !prompt.isEmpty else { return nil }
        let rawIcon = (d["icon"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? "custom"
        let icon = validIcons.contains(rawIcon) ? rawIcon : "custom"
        let replaces = (d["replaces"] as? Bool) ?? true

        var items = library()
        let givenId = (d["id"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        if !givenId.isEmpty, let idx = items.firstIndex(where: { $0.id == givenId }) {
            items[idx] = ActionDef(id: givenId, name: name, icon: icon, prompt: isLocal(givenId) ? "" : prompt, replaces: replaces)
        } else {
            let newId = givenId.isEmpty
                ? ("u" + String(Int(Date().timeIntervalSince1970 * 1000), radix: 36) + String(Int.random(in: 100...999)))
                : givenId
            items.append(ActionDef(id: newId, name: name, icon: icon, prompt: prompt, replaces: replaces))
        }
        let arr: [[String: Any]] = items.map {
            ["id": $0.id, "name": $0.name ?? "", "icon": $0.icon, "prompt": $0.prompt, "replaces": $0.replaces]
        }
        guard let data = try? JSONSerialization.data(withJSONObject: arr),
              let json = String(data: data, encoding: .utf8) else { return nil }
        (NSApp.delegate as? AppDelegate)?.setSetting("actionsList", json)
        return json
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
