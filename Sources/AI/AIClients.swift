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
    static let action: TimeInterval = 90
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

    /// Multi-turn streaming chat; yields incremental text deltas.
    static func chatStream(_ ep: AIEndpoint, key: String?, model: String, system: String?,
                           messages: [[String: String]], maxTokens: Int?, timeout: TimeInterval) -> AsyncThrowingStream<String, Error> {
        ep.kind == "anthropic"
            ? AnthropicClient.chatStream(ep, key: key, model: model, system: system, messages: messages, maxTokens: maxTokens, timeout: timeout)
            : OpenAIClient.chatStream(ep, key: key, model: model, system: system, messages: messages, maxTokens: maxTokens, timeout: timeout)
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

    /// Streams SSE lines from a request, validating HTTP 2xx status and propagating cancellation.
    static func streamLines(_ r: URLRequest, key: String?, onLine: (String) throws -> Bool) async throws {
        let (bytes, response): (URLSession.AsyncBytes, URLResponse)
        do { (bytes, response) = try await session.bytes(for: r) }
        catch let err as CancellationError { throw err }
        catch let err as URLError where err.code == .cancelled { throw CancellationError() }
        catch { throw AIError(scrub(error.localizedDescription, key)) }

        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            var errData = Data()
            do {
                for try await b in bytes {
                    errData.append(b)
                    if errData.count >= 65_536 { break }
                }
            } catch {}
            throw AIError(scrub("HTTP \(status): " + errorMessage(errData, status: status), key))
        }

        do {
            for try await line in bytes.lines {
                try Task.checkCancellation()
                if try !onLine(line) { break }
            }
        }
        catch let err as CancellationError { throw err }
        catch let err as URLError where err.code == .cancelled { throw CancellationError() }
        catch let err as AIError { throw err }
        catch { throw AIError(scrub(error.localizedDescription, key)) }
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

    static func chatStream(_ ep: AIEndpoint, key: String?, model: String, system: String?,
                           messages: [[String: String]], maxTokens: Int?, timeout: TimeInterval) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    guard let base = AIHTTP.base(ep.baseURL) else { throw AIError("Invalid base URL") }
                    var msgs: [[String: Any]] = []
                    if let system, !system.isEmpty { msgs.append(["role": "system", "content": system]) }
                    for m in messages {
                        guard let role = m["role"], let content = m["content"], !content.isEmpty else { continue }
                        msgs.append(["role": role, "content": content])
                    }
                    var body: [String: Any] = ["model": model, "messages": msgs, "stream": true]
                    if let maxTokens { body[ep.kind == "openai" ? "max_completion_tokens" : "max_tokens"] = maxTokens }
                    var h = headers(key)
                    h["Accept"] = "text/event-stream, application/json"
                    let r = try AIHTTP.request(base + "/chat/completions", method: "POST", headers: h, body: body, timeout: timeout)
                    try await AIHTTP.streamLines(r, key: key) { line in
                        guard line.hasPrefix("data:") else { return true }
                        let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        if payload.isEmpty { return true }
                        if payload == "[DONE]" { return false }
                        guard let obj = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return true }
                        if let err = obj["error"] {
                            let msg = (err as? [String: Any])?["message"] as? String
                                ?? (err as? String)
                                ?? AIHTTP.errorMessage(Data(payload.utf8), status: 200)
                            throw AIError(AIHTTP.scrub(msg, key))
                        }
                        guard let choices = obj["choices"] as? [[String: Any]], let first = choices.first,
                              let delta = first["delta"] as? [String: Any] else { return true }
                        if let s = delta["content"] as? String, !s.isEmpty {
                            continuation.yield(s)
                        } else if let parts = delta["content"] as? [[String: Any]] {
                            let s = parts.compactMap { $0["text"] as? String }.joined()
                            if !s.isEmpty { continuation.yield(s) }
                        }
                        return true
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
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
            guard var comps = URLComponents(string: root + "/models") else { throw AIError("Invalid base URL") }
            comps.queryItems = [URLQueryItem(name: "limit", value: "1000")] + (after.map { [URLQueryItem(name: "after_id", value: $0)] } ?? [])
            // URLComponents leaves "+" alone in queries; encode it so an id containing "+" survives.
            comps.percentEncodedQuery = comps.percentEncodedQuery?.replacingOccurrences(of: "+", with: "%2B")
            guard let url = comps.string else { throw AIError("Invalid base URL") }
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

    /// Normalizes message history for Anthropic's alternating user/assistant turn requirements.
    static func normalizeMessages(_ messages: [[String: String]]) -> [[String: String]] {
        var out: [[String: String]] = []
        for m in messages {
            guard let role = m["role"], role == "user" || role == "assistant",
                  let content = m["content"], !content.isEmpty else { continue }
            if let last = out.last, last["role"] == role {
                out[out.count - 1]["content"] = (last["content"] ?? "") + "\n\n" + content
            } else {
                out.append(["role": role, "content": content])
            }
        }
        while !out.isEmpty && out.first?["role"] != "user" {
            out.removeFirst()
        }
        return out
    }

    static func chatStream(_ ep: AIEndpoint, key: String?, model: String, system: String?,
                           messages: [[String: String]], maxTokens: Int?, timeout: TimeInterval) -> AsyncThrowingStream<String, Error> {
        AsyncThrowingStream { continuation in
            let task = Task {
                do {
                    let root = try root(ep)
                    let msgs = normalizeMessages(messages)
                    var body: [String: Any] = ["model": model, "max_tokens": maxTokens ?? 8192,
                                               "messages": msgs, "stream": true]
                    if let system, !system.isEmpty { body["system"] = system }
                    var h = headers(key)
                    h["Accept"] = "text/event-stream, application/json"
                    let r = try AIHTTP.request(root + "/messages", method: "POST", headers: h, body: body, timeout: timeout)
                    var currentEvent = ""
                    try await AIHTTP.streamLines(r, key: key) { line in
                        if line.hasPrefix("event:") {
                            currentEvent = String(line.dropFirst(6)).trimmingCharacters(in: .whitespaces)
                            return true
                        }
                        guard line.hasPrefix("data:") else { return true }
                        let eventName = currentEvent
                        currentEvent = ""
                        let payload = String(line.dropFirst(5)).trimmingCharacters(in: .whitespaces)
                        if payload.isEmpty { return true }
                        if payload == "[DONE]" { return false }
                        guard let obj = (try? JSONSerialization.jsonObject(with: Data(payload.utf8))) as? [String: Any] else { return true }
                        let type = (obj["type"] as? String) ?? eventName
                        if type == "error" || obj["error"] != nil {
                            let msg = (obj["error"] as? [String: Any])?["message"] as? String
                                ?? (obj["error"] as? String)
                                ?? AIHTTP.errorMessage(Data(payload.utf8), status: 200)
                            throw AIError(AIHTTP.scrub(msg, key))
                        }
                        if type == "content_block_delta",
                           let delta = obj["delta"] as? [String: Any],
                           (delta["type"] as? String) == "text_delta",
                           let text = delta["text"] as? String, !text.isEmpty {
                            continuation.yield(text)
                        }
                        if type == "message_stop" { return false }
                        return true
                    }
                    continuation.finish()
                } catch {
                    continuation.finish(throwing: error)
                }
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }
}
