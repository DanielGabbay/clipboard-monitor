import Foundation

// MARK: - HTTP clients for LLM providers
//
// OpenAI-compatible (OpenAI, Gemini's /v1beta/openai, OpenRouter, Ollama, LM Studio, custom):
//   GET {base}/models, POST {base}/chat/completions, Authorization: Bearer <key> when there is a key.
// Anthropic: GET {base}/v1/models (paged), POST {base}/v1/messages, x-api-key + anthropic-version.
// Errors are human readable ("HTTP 401: <provider message>" or the network error) and never contain the key.

struct AIEndpoint: Sendable {
    let kind: String
    let baseURL: String
}

struct RemoteModel: Sendable {
    let id: String
    let label: String?
}

struct AIError: LocalizedError, Sendable {
    let message: String
    init(_ message: String) { self.message = message }
    var errorDescription: String? { message }
}

enum AITimeout {
    static let models: TimeInterval = 15
    static let check: TimeInterval = 20
    static let translate: TimeInterval = 60
}

enum AIClient {
    static func listModels(_ ep: AIEndpoint, key: String?, timeout: TimeInterval = AITimeout.models) async throws -> [RemoteModel] {
        ep.kind == "anthropic"
            ? try await AnthropicClient.listModels(ep, key: key, timeout: timeout)
            : try await OpenAIClient.listModels(ep, key: key, timeout: timeout)
    }

    /// One non-streaming chat turn; returns the reply text.
    static func chat(_ ep: AIEndpoint, key: String?, model: String, system: String?, user: String,
                     maxTokens: Int?, timeout: TimeInterval) async throws -> String {
        ep.kind == "anthropic"
            ? try await AnthropicClient.chat(ep, key: key, model: model, system: system, user: user, maxTokens: maxTokens, timeout: timeout)
            : try await OpenAIClient.chat(ep, key: key, model: model, system: system, user: user, maxTokens: maxTokens, timeout: timeout)
    }
}

enum AIHTTP {
    static let session: URLSession = {
        let c = URLSessionConfiguration.ephemeral
        c.httpCookieStorage = nil
        c.urlCache = nil
        c.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: c)
    }()

    /// Base URL without trailing slashes; nil when it is not an http(s) URL.
    static func base(_ s: String) -> String? {
        var b = s.trimmingCharacters(in: .whitespacesAndNewlines)
        while b.hasSuffix("/") { b.removeLast() }
        guard let u = URL(string: b), let scheme = u.scheme?.lowercased(), scheme == "http" || scheme == "https", u.host != nil
        else { return nil }
        return b
    }

    static func request(_ urlString: String, method: String = "GET", headers: [String: String], body: Any? = nil,
                        timeout: TimeInterval) throws -> URLRequest {
        guard let url = URL(string: urlString) else { throw AIError("Invalid URL") }
        var r = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: timeout)
        r.httpMethod = method
        r.setValue("application/json", forHTTPHeaderField: "Accept")
        for (k, v) in headers { r.setValue(v, forHTTPHeaderField: k) }
        if let body {
            r.httpBody = try JSONSerialization.data(withJSONObject: body)
            r.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        return r
    }

    /// Sends the request and returns the decoded JSON body of a 2xx response.
    static func json(_ r: URLRequest, key: String?) async throws -> Any {
        let data: Data, response: URLResponse
        do { (data, response) = try await session.data(for: r) } catch {
            throw AIError(scrub(error.localizedDescription, key))
        }
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            throw AIError(scrub("HTTP \(status): " + errorMessage(data, status: status), key))
        }
        do { return try JSONSerialization.jsonObject(with: data) } catch {
            throw AIError("Invalid response from the server")
        }
    }

    /// Pulls the provider's message out of the common error shapes: {"error":{"message"}}, {"error":"..."},
    /// [{"error":{...}}] (Gemini), {"message"} / {"detail"}; falls back to the start of the body.
    static func errorMessage(_ data: Data, status: Int) -> String {
        var obj = try? JSONSerialization.jsonObject(with: data)
        if let arr = obj as? [Any], let first = arr.first { obj = first }
        if let d = obj as? [String: Any] {
            if let e = d["error"] as? [String: Any], let m = e["message"] as? String, !m.isEmpty { return m }
            if let e = d["error"] as? String, !e.isEmpty { return e }
            if let m = d["message"] as? String, !m.isEmpty { return m }
            if let m = d["detail"] as? String, !m.isEmpty { return m }
        }
        let text = String(decoding: data.prefix(300), as: UTF8.self).trimmingCharacters(in: .whitespacesAndNewlines)
        return text.isEmpty || text.hasPrefix("<") ? HTTPURLResponse.localizedString(forStatusCode: status) : text
    }

    /// Defence in depth: a provider that echoes the key back never gets it into our error strings.
    static func scrub(_ s: String, _ key: String?) -> String {
        guard let key, key.count >= 4 else { return s }
        return s.replacingOccurrences(of: key, with: "•••")
    }
}

enum OpenAIClient {
    static func headers(_ key: String?) -> [String: String] {
        guard let key, !key.isEmpty else { return [:] }
        return ["Authorization": "Bearer " + key]
    }

    static func listModels(_ ep: AIEndpoint, key: String?, timeout: TimeInterval) async throws -> [RemoteModel] {
        guard let base = AIHTTP.base(ep.baseURL) else { throw AIError("Invalid base URL") }
        let r = try AIHTTP.request(base + "/models", headers: headers(key), timeout: timeout)
        let obj = try await AIHTTP.json(r, key: key)
        // {"data":[{"id":...}]} (OpenAI); some servers answer {"models":[...]} or a bare array.
        let list = (obj as? [String: Any])?["data"] as? [[String: Any]]
            ?? (obj as? [String: Any])?["models"] as? [[String: Any]]
            ?? obj as? [[String: Any]] ?? []
        return list.compactMap { m in
            guard let id = (m["id"] as? String) ?? (m["name"] as? String) else { return nil }
            let label = m["name"] as? String
            return RemoteModel(id: id, label: label == id ? nil : label)
        }
    }

    static func chat(_ ep: AIEndpoint, key: String?, model: String, system: String?, user: String,
                     maxTokens: Int?, timeout: TimeInterval) async throws -> String {
        guard let base = AIHTTP.base(ep.baseURL) else { throw AIError("Invalid base URL") }
        var messages: [[String: Any]] = []
        if let system { messages.append(["role": "system", "content": system]) }
        messages.append(["role": "user", "content": user])
        var body: [String: Any] = ["model": model, "messages": messages, "stream": false]
        // OpenAI's newer models only accept max_completion_tokens; other compatible servers know max_tokens.
        if let maxTokens { body[ep.kind == "openai" ? "max_completion_tokens" : "max_tokens"] = maxTokens }
        let r = try AIHTTP.request(base + "/chat/completions", method: "POST", headers: headers(key), body: body, timeout: timeout)
        let obj = try await AIHTTP.json(r, key: key)
        guard let choices = (obj as? [String: Any])?["choices"] as? [[String: Any]], let first = choices.first,
              let message = first["message"] as? [String: Any] else { throw AIError("Invalid response from the server") }
        if let s = message["content"] as? String { return s }
        if let parts = message["content"] as? [[String: Any]] { return parts.compactMap { $0["text"] as? String }.joined() }
        return ""
    }
}

enum AnthropicClient {
    static let version = "2023-06-01"

    /// The base is the host (https://api.anthropic.com); a base that already ends in /v1 is accepted too.
    static func root(_ ep: AIEndpoint) throws -> String {
        guard var base = AIHTTP.base(ep.baseURL) else { throw AIError("Invalid base URL") }
        if base.hasSuffix("/v1") { base.removeLast(3) }
        return base + "/v1"
    }

    static func headers(_ key: String?) -> [String: String] {
        var h = ["anthropic-version": version]
        if let key, !key.isEmpty { h["x-api-key"] = key }
        return h
    }

    static func listModels(_ ep: AIEndpoint, key: String?, timeout: TimeInterval) async throws -> [RemoteModel] {
        let root = try root(ep)
        var out: [RemoteModel] = []
        var after: String?
        for _ in 0..<20 {   // pages of 1000; the cap only guards against a server that never stops
            var url = root + "/models?limit=1000"
            if let after, let enc = after.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) { url += "&after_id=" + enc }
            let obj = try await AIHTTP.json(try AIHTTP.request(url, headers: headers(key), timeout: timeout), key: key)
            guard let d = obj as? [String: Any] else { throw AIError("Invalid response from the server") }
            let data = d["data"] as? [[String: Any]] ?? []
            out += data.compactMap { m in
                (m["id"] as? String).map { RemoteModel(id: $0, label: m["display_name"] as? String) }
            }
            guard (d["has_more"] as? Bool) == true, let last = (d["last_id"] as? String) ?? out.last?.id, last != after else { break }
            after = last
        }
        return out
    }

    static func chat(_ ep: AIEndpoint, key: String?, model: String, system: String?, user: String,
                     maxTokens: Int?, timeout: TimeInterval) async throws -> String {
        let root = try root(ep)
        var body: [String: Any] = ["model": model, "max_tokens": maxTokens ?? 8192,
                                   "messages": [["role": "user", "content": user]]]
        if let system { body["system"] = system }
        let r = try AIHTTP.request(root + "/messages", method: "POST", headers: headers(key), body: body, timeout: timeout)
        let obj = try await AIHTTP.json(r, key: key)
        guard let content = (obj as? [String: Any])?["content"] as? [[String: Any]] else {
            throw AIError("Invalid response from the server")
        }
        return content.filter { ($0["type"] as? String) == "text" }.compactMap { $0["text"] as? String }.joined()
    }
}
