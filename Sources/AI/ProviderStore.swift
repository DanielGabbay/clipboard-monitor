import Foundation

// MARK: - AI provider data model and its JSON store
//
// ~/Library/Application Support/Clipboard Monitor/ai-providers.json, permissions 0600. It never holds an API key:
// keys live in the Keychain (AIKeychain). `keyHint` ("…" + last 4 characters, or "" when there is no key) is kept
// here as display metadata so the page can be drawn without reading the Keychain.

/// Result of a health check (provider: list models; model: a tiny chat request). `time` is ms since 1970.
struct AICheck: Codable {
    var ok: Bool
    var ms: Int
    var error: String?
    var time: Double
}

struct AIModel: Codable {
    var id: String
    var label: String?
    var hidden: Bool = false
    var isNew: Bool = false
    var missing: Bool = false
    var lastCheck: AICheck?

    init(id: String, label: String? = nil, hidden: Bool = false, isNew: Bool = false) {
        self.id = id; self.label = label; self.hidden = hidden; self.isNew = isNew
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        label = try c.decodeIfPresent(String.self, forKey: .label)
        hidden = try c.decodeIfPresent(Bool.self, forKey: .hidden) ?? false
        isNew = try c.decodeIfPresent(Bool.self, forKey: .isNew) ?? false
        missing = try c.decodeIfPresent(Bool.self, forKey: .missing) ?? false
        lastCheck = try c.decodeIfPresent(AICheck.self, forKey: .lastCheck)
    }
}

struct AIProvider: Codable {
    var id: String
    var name: String
    var kind: String            // openai | anthropic | gemini | openrouter | ollama | lmstudio | custom
    var baseURL: String
    var enabled: Bool = true
    var autoRefresh: Bool = true
    var lastRefresh: Double = 0 // ms since 1970, last successful model refresh
    var keyHint: String = ""    // "…a1b2" when a key is stored in the Keychain, else ""
    var lastCheck: AICheck?
    var models: [AIModel] = []

    var hasKey: Bool { !keyHint.isEmpty }
    var endpoint: AIEndpoint { AIEndpoint(kind: kind, baseURL: baseURL) }

    init(id: String, name: String, kind: String, baseURL: String) {
        self.id = id; self.name = name; self.kind = kind; self.baseURL = baseURL
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? ""
        kind = try c.decodeIfPresent(String.self, forKey: .kind) ?? "custom"
        baseURL = try c.decodeIfPresent(String.self, forKey: .baseURL) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? true
        autoRefresh = try c.decodeIfPresent(Bool.self, forKey: .autoRefresh) ?? true
        lastRefresh = try c.decodeIfPresent(Double.self, forKey: .lastRefresh) ?? 0
        keyHint = try c.decodeIfPresent(String.self, forKey: .keyHint) ?? ""
        lastCheck = try c.decodeIfPresent(AICheck.self, forKey: .lastCheck)
        models = try c.decodeIfPresent([AIModel].self, forKey: .models) ?? []
    }

    /// Merges a fresh model list: new models come in hidden and marked new, models that disappeared are kept and
    /// marked missing, models that came back lose the missing mark. Returns the ids that were added.
    /// The first list of a provider comes in visible when it is short (a fresh provider should not look empty);
    /// long first lists (OpenRouter returns hundreds) come in hidden and marked new like later additions.
    static let firstListVisibleLimit = 30

    @discardableResult
    mutating func mergeModels(_ remote: [RemoteModel]) -> [String] {
        var seen = Set<String>()
        let fresh = remote.filter { !$0.id.isEmpty && seen.insert($0.id).inserted }
        let ids = Set(fresh.map { $0.id })
        let known = Set(models.map { $0.id })
        for i in models.indices { models[i].missing = !ids.contains(models[i].id) }
        let added = fresh.filter { !known.contains($0.id) }
        let firstVisible = models.isEmpty && added.count <= Self.firstListVisibleLimit
        models += added.map { AIModel(id: $0.id, label: $0.label, hidden: !firstVisible, isNew: !firstVisible) }
        return added.map { $0.id }
    }
}

struct AIPreset {
    let kind: String, name: String, baseURL: String, needsKey: Bool
    var forPage: [String: Any] { ["kind": kind, "name": name, "baseURL": baseURL, "needsKey": needsKey] }

    static let all: [AIPreset] = [
        .init(kind: "openai", name: "OpenAI", baseURL: "https://api.openai.com/v1", needsKey: true),
        .init(kind: "anthropic", name: "Anthropic", baseURL: "https://api.anthropic.com", needsKey: true),
        .init(kind: "gemini", name: "Google Gemini", baseURL: "https://generativelanguage.googleapis.com/v1beta/openai", needsKey: true),
        .init(kind: "openrouter", name: "OpenRouter", baseURL: "https://openrouter.ai/api/v1", needsKey: true),
        .init(kind: "ollama", name: "Ollama", baseURL: "http://localhost:11434/v1", needsKey: false),
        .init(kind: "lmstudio", name: "LM Studio", baseURL: "http://localhost:1234/v1", needsKey: false),
        .init(kind: "custom", name: "OpenAI-compatible", baseURL: "", needsKey: false),
    ]
    static func of(_ kind: String) -> AIPreset? { all.first { $0.kind == kind } }
}

enum ProviderStore {
    static var url: URL { AppDelegate.supportDir.appendingPathComponent("ai-providers.json") }

    static func load(from url: URL = url) -> [AIProvider] {
        guard let data = try? Data(contentsOf: url) else { return [] }
        do { return try JSONDecoder().decode([AIProvider].self, from: data) } catch {
            // Keep the unreadable file aside so the next save cannot silently erase the user's providers.
            let stamp = ISO8601DateFormatter().string(from: Date()).replacingOccurrences(of: ":", with: "-")
            let backup = url.deletingLastPathComponent().appendingPathComponent("ai-providers.unreadable-\(stamp).json")
            try? FileManager.default.moveItem(at: url, to: backup)
            NSLog("Clipboard Monitor: could not read ai-providers.json (\(error.localizedDescription)); kept it as \(backup.lastPathComponent)")
            return []
        }
    }

    /// Atomic write; the file is created with 0600 so it is never readable by others, even briefly.
    static func save(_ providers: [AIProvider], to url: URL = url) {
        let enc = JSONEncoder()
        enc.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? enc.encode(providers) else { return }
        let tmp = url.deletingLastPathComponent().appendingPathComponent(".ai-providers.\(UUID().uuidString).tmp")
        guard FileManager.default.createFile(atPath: tmp.path, contents: data, attributes: [.posixPermissions: 0o600]) else {
            NSLog("Clipboard Monitor: could not write ai-providers.json")
            return
        }
        if rename(tmp.path, url.path) != 0 {
            try? FileManager.default.removeItem(at: tmp)
            NSLog("Clipboard Monitor: could not replace ai-providers.json (errno \(errno))")
        }
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: url.path)
    }

    /// The page's view of a provider (no secrets): the stored fields plus the computed `hasKey`.
    static func pageDict(_ p: AIProvider) -> [String: Any] {
        guard let data = try? JSONEncoder().encode(p),
              var d = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return ["id": p.id] }
        d["hasKey"] = p.hasKey
        return d
    }
}
