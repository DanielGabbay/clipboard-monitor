import Cocoa

// MARK: - AI providers service
//
// Bridge contract (see docs/PLAN-settings-ai-i18n.md): page -> native `ai.*` commands, native -> page
// `monitor.aiState({providers, presets})` broadcast to every window after any change, and
// `monitor.aiEvent({id, modelId?, kind: "check" | "refresh", ok, ms, error?, time, added?})` to the asking window.
// API keys live only in the Keychain (AIKeychain) and are never sent to the page.
@MainActor
final class AIService {
    static let shared = AIService()

    private(set) var providers: [AIProvider]
    private var refresher: ModelRefresher?
    private var refreshing = Set<String>()

    private init() {
        providers = ProviderStore.load()
        // A hint whose Keychain item is gone (deleted by hand in Keychain Access) would claim a key we do not have.
        var changed = false
        // Only a definite "not found" clears it: other Keychain errors (an ACL mismatch after a rebuild) keep the hint.
        for i in providers.indices where providers[i].hasKey && AIKeychain.isMissing(account: providers[i].id) {
            providers[i].keyHint = ""; changed = true
        }
        if changed { ProviderStore.save(providers) }
    }

    /// Called once at launch: starts the automatic model refresh.
    func start() {
        if refresher == nil { refresher = ModelRefresher(service: self) }
        refresher?.start()
    }

    /// The state every window shows: {providers: [...], presets: [...]}. No secrets.
    func stateForPage() -> [String: Any] {
        ["providers": providers.map(ProviderStore.pageDict), "presets": AIPreset.all.map { $0.forPage }]
    }

    func broadcastState() {
        guard let app = NSApp.delegate as? AppDelegate else { return }
        let s = stateForPage()
        app.controllers.forEach { $0.call("monitor.aiState", s) }
    }

    func provider(_ id: String) -> AIProvider? { providers.first { $0.id == id } }

    private func index(_ id: String?) -> Int? {
        guard let id else { return nil }
        return providers.firstIndex { $0.id == id }
    }

    /// Saves and broadcasts once per run-loop turn, so a burst of changes ("Test all visible" on many models)
    /// writes the file and re-renders the windows once instead of once per change.
    private var commitPending = false
    private func commit() {
        guard !commitPending else { return }
        commitPending = true
        DispatchQueue.main.async { [self] in
            commitPending = false
            ProviderStore.save(providers)
            broadcastState()
        }
    }

    private static func now() -> Double { (Date().timeIntervalSince1970 * 1000).rounded() }

    // MARK: bridge

    func handle(_ cmd: String, _ body: [String: Any], from c: MonitorController) {
        let id = body["id"] as? String
        switch cmd {
        case "ai.list":
            c.call("monitor.aiState", stateForPage())
        case "ai.save":
            save(body, from: c)
        case "ai.delete":
            guard let i = index(id) else { return broadcastState() }
            AIKeychain.delete(account: providers[i].id)
            providers.remove(at: i)
            commit()
        case "ai.toggle":
            guard let i = index(id) else { return broadcastState() }
            providers[i].enabled = (body["enabled"] as? Bool) ?? !providers[i].enabled
            commit()
        case "ai.refreshModels":
            guard let id else { return }
            Task { [weak c] in await self.refresh(id, asker: c) }
        case "ai.setModel":
            guard let i = index(id), let modelId = body["modelId"] as? String,
                  let m = providers[i].models.firstIndex(where: { $0.id == modelId }) else { return broadcastState() }
            if let hidden = body["hidden"] as? Bool { providers[i].models[m].hidden = hidden; providers[i].models[m].isNew = false }
            if body.keys.contains("label") {
                let label = (body["label"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                providers[i].models[m].label = label.isEmpty ? nil : label
            }
            commit()
        case "ai.setModels":
            // {id, hidden, onlyNew?} (also accepts `all: true`, which is the default)
            guard let i = index(id), let hidden = body["hidden"] as? Bool else { return broadcastState() }
            let onlyNew = (body["onlyNew"] as? Bool) ?? false
            for m in providers[i].models.indices where !onlyNew || providers[i].models[m].isNew {
                providers[i].models[m].hidden = hidden
                providers[i].models[m].isNew = false
            }
            commit()
        case "ai.checkProvider":
            guard let id else { return }
            Task { [weak c] in await self.checkProvider(id, asker: c) }
        case "ai.checkModel":
            guard let id, let modelId = body["modelId"] as? String else { return }
            Task { [weak c] in await self.checkModel(id, modelId: modelId, asker: c) }
        default:
            break
        }
    }

    /// ai.save {provider: {id?, name, kind, baseURL, enabled, autoRefresh}, apiKey?}
    /// apiKey missing or "" keeps the stored key, null deletes it, a string replaces it.
    private func save(_ body: [String: Any], from c: MonitorController) {
        guard let pd = body["provider"] as? [String: Any] else { return broadcastState() }
        let existing = index(pd["id"] as? String)
        let kindIn = (pd["kind"] as? String) ?? (existing.map { providers[$0].kind } ?? "custom")
        let preset = AIPreset.of(kindIn) ?? AIPreset.of("custom")!
        var p = existing.map { providers[$0] } ?? AIProvider(id: UUID().uuidString, name: preset.name, kind: preset.kind, baseURL: preset.baseURL)
        p.kind = preset.kind
        if let name = (pd["name"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines) { p.name = name.isEmpty ? preset.name : name }
        if let url = pd["baseURL"] as? String {
            var u = url.trimmingCharacters(in: .whitespacesAndNewlines)
            while u.hasSuffix("/") { u.removeLast() }
            p.baseURL = u.isEmpty ? preset.baseURL : u
        }
        if let v = pd["enabled"] as? Bool { p.enabled = v }
        // A stored key only ever goes to the endpoint it was entered for: moving a provider to another URL or kind
        // without supplying a key again drops the old key.
        let newKeyGiven = !(((body["apiKey"] as? String) ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        if let i = existing, providers[i].hasKey, !newKeyGiven,
           providers[i].baseURL != p.baseURL || providers[i].kind != p.kind {
            AIKeychain.delete(account: p.id)
            p.keyHint = ""
        }
        if let v = pd["autoRefresh"] as? Bool { p.autoRefresh = v }

        if body["apiKey"] is NSNull {
            AIKeychain.delete(account: p.id)
            p.keyHint = ""
        } else if let key = (body["apiKey"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines), !key.isEmpty {
            if let err = AIKeychain.save(key, account: p.id, label: "Clipboard Monitor: \(p.name)") {
                c.call("monitor.aiEvent", ["id": p.id, "kind": "save", "ok": false, "error": err, "time": Self.now()])
            } else {
                p.keyHint = AIKeychain.hint(key)
            }
        }

        let isNew = existing == nil
        if let i = existing { providers[i] = p } else { providers.append(p) }
        commit()
        // A new provider fetches its model list right away (a short first list arrives visible, a long one hidden).
        if isNew && p.enabled {
            let id = p.id
            Task { [weak c] in await self.refresh(id, asker: c) }
        }
    }

    // MARK: requests

    /// Reads the key from the Keychain for one request; nothing keeps it afterwards.
    private func key(for p: AIProvider) -> String? {
        p.hasKey ? AIKeychain.read(account: p.id) : nil
    }

    private func send(_ event: [String: Any], to c: MonitorController?) {
        c?.call("monitor.aiEvent", event)
    }

    private static func event(_ id: String, kind: String, _ check: AICheck, modelId: String? = nil) -> [String: Any] {
        var e: [String: Any] = ["id": id, "kind": kind, "ok": check.ok, "ms": check.ms, "time": check.time]
        if let modelId { e["modelId"] = modelId }
        if let error = check.error { e["error"] = error }
        return e
    }

    /// Times an async request and turns its outcome into an AICheck.
    private func timed<T>(_ work: () async throws -> T) async -> (T?, AICheck) {
        let start = Date()
        do {
            let value = try await work()
            return (value, AICheck(ok: true, ms: Int(Date().timeIntervalSince(start) * 1000), error: nil, time: Self.now()))
        } catch {
            return (nil, AICheck(ok: false, ms: Int(Date().timeIntervalSince(start) * 1000), error: error.localizedDescription, time: Self.now()))
        }
    }

    /// Lists the provider's models and merges them in. Also records the result as the provider's lastCheck.
    func refresh(_ id: String, asker: MonitorController?) async {
        guard let p = provider(id), !refreshing.contains(id) else { return }
        refreshing.insert(id)
        defer { refreshing.remove(id) }
        let key = key(for: p)
        let (models, check) = await timed { try await AIClient.listModels(p.endpoint, key: key, timeout: AITimeout.models) }
        guard let i = index(id) else { return }   // deleted while the request ran
        var added: [String] = []
        if let models {
            added = providers[i].mergeModels(models)
            providers[i].lastRefresh = check.time
        }
        providers[i].lastCheck = check
        commit()
        var e = Self.event(id, kind: "refresh", check)
        e["added"] = added
        send(e, to: asker)
    }

    func checkProvider(_ id: String, asker: MonitorController?) async {
        guard let p = provider(id) else { return }
        let key = key(for: p)
        let (_, check) = await timed { try await AIClient.listModels(p.endpoint, key: key, timeout: AITimeout.check) }
        guard let i = index(id) else { return }
        providers[i].lastCheck = check
        commit()
        send(Self.event(id, kind: "check", check), to: asker)
    }

    func checkModel(_ id: String, modelId: String, asker: MonitorController?) async {
        guard let p = provider(id) else { return }
        let key = key(for: p)
        let (_, check) = await timed {
            try await AIClient.chat(p.endpoint, key: key, model: modelId, system: nil, user: "Reply with OK",
                                    maxTokens: 16, timeout: AITimeout.check)
        }
        guard let i = index(id) else { return }
        if let m = providers[i].models.firstIndex(where: { $0.id == modelId }) { providers[i].models[m].lastCheck = check }
        commit()
        send(Self.event(id, kind: "check", check, modelId: modelId), to: asker)
    }

    /// Used by translation: one chat turn with a stored provider and model.
    func chat(providerId: String, model: String, system: String?, user: String, maxTokens: Int?, timeout: TimeInterval) async throws -> String {
        guard let p = provider(providerId) else { throw AIError("AI provider not found") }
        let key = key(for: p)
        return try await AIClient.chat(p.endpoint, key: key, model: model, system: system, user: user, maxTokens: maxTokens, timeout: timeout)
    }
}
