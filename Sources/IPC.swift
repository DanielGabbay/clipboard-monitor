import Cocoa
import Foundation

// MARK: - Local IPC & CLI / MCP Engine
//
// Provides:
// 1. CLI entry points: --help, rtl, flip, show, history, action, translate, --mcp
// 2. Local Unix Domain Socket server: ~/Library/Application Support/Clipboard Monitor/textmonitor.sock
//    (or TEXTMONITOR_SUPPORT_DIR override)
// 3. MCP JSON-RPC 2.0 server over stdin/stdout for AI integrations

final class IPCServer {
    static let shared = IPCServer()

    private var serverSource: DispatchSourceRead?
    private var serverFd: Int32 = -1
    private(set) var socketPath: String = ""

    static func supportDirectory() -> URL {
        if let custom = ProcessInfo.processInfo.environment["TEXTMONITOR_SUPPORT_DIR"], !custom.isEmpty {
            return URL(fileURLWithPath: custom)
        }
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("Clipboard Monitor", isDirectory: true)
    }

    static func defaultSocketPath() -> String {
        supportDirectory().appendingPathComponent("textmonitor.sock").path
    }

    func start() {
        let path = Self.defaultSocketPath()
        self.socketPath = path

        let dir = URL(fileURLWithPath: path).deletingLastPathComponent().path
        try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)

        let pathBytes = path.utf8.count
        guard pathBytes <= 104 else {
            // Sun_path limit is typically 104 bytes on Darwin.
            // If the path exceeds 104 bytes, skip binding to avoid buffer overflow or crash.
            return
        }

        // Check if existing socket is active or stale
        if FileManager.default.fileExists(atPath: path) {
            let testFd = socket(AF_UNIX, SOCK_STREAM, 0)
            if testFd >= 0 {
                var addr = sockaddr_un()
                addr.sun_family = sa_family_t(AF_UNIX)
                strncpy(&addr.sun_path.0, path, 103)
                let connected = withUnsafePointer(to: &addr) {
                    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                        connect(testFd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
                    }
                }
                close(testFd)
                if connected == 0 {
                    // Another instance is actively running; don't take over socket
                    return
                }
            }
            unlink(path)
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        strncpy(&addr.sun_path.0, path, 103)

        let bindRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                bind(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard bindRes == 0 else {
            close(fd)
            return
        }

        chmod(path, 0o600)
        guard listen(fd, 16) == 0 else {
            close(fd)
            unlink(path)
            return
        }

        self.serverFd = fd
        let source = DispatchSource.makeReadSource(fileDescriptor: fd, queue: DispatchQueue.global(qos: .userInitiated))
        source.setEventHandler { [weak self] in
            guard let self = self else { return }
            var clientAddr = sockaddr_un()
            var clientLen = socklen_t(MemoryLayout<sockaddr_un>.size)
            let clientFd = withUnsafeMutablePointer(to: &clientAddr) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                    accept(self.serverFd, $0, &clientLen)
                }
            }
            guard clientFd >= 0 else { return }
            DispatchQueue.global(qos: .userInitiated).async {
                self.handleClient(clientFd)
            }
        }
        source.setCancelHandler {
            close(fd)
            unlink(path)
        }
        source.resume()
        self.serverSource = source
    }

    func stop() {
        serverSource?.cancel()
        serverSource = nil
        serverFd = -1
        if !socketPath.isEmpty && socketPath.utf8.count <= 104 {
            unlink(socketPath)
        }
    }

    private func handleClient(_ clientFd: Int32) {
        defer { close(clientFd) }
        var data = Data()
        var buf = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(clientFd, &buf, buf.count)
            if n <= 0 { break }
            data.append(buf, count: n)
            if data.contains(0x0A) { break }
        }

        guard let line = String(data: data, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines),
              !line.isEmpty,
              let json = try? JSONSerialization.jsonObject(with: Data(line.utf8)) as? [String: Any],
              let cmd = json["cmd"] as? String else {
            return
        }

        var response: [String: Any] = ["ok": true]
        let sema = DispatchSemaphore(value: 0)

        DispatchQueue.main.async {
            guard let appDelegate = NSApp.delegate as? AppDelegate else {
                response = ["ok": false, "error": "App not ready"]
                sema.signal()
                return
            }

            switch cmd {
            case "show":
                appDelegate.showMonitor(nil)
                response = ["ok": true]
                sema.signal()

            case "history":
                let items = appDelegate.readHistoryFile()
                response = ["ok": true, "items": items]
                sema.signal()

            case "push":
                if let text = json["text"] as? String {
                    appDelegate.pushExternalText(text)
                    response = ["ok": true]
                } else {
                    response = ["ok": false, "error": "Missing text parameter"]
                }
                sema.signal()

            case "action":
                if let id = json["id"] as? String {
                    let text = json["text"] as? String
                    Task {
                        do {
                            let res = try await TextActions.run(id: id, query: text, text: text ?? "", app: nil)
                            response = ["ok": true, "result": res.text]
                        } catch {
                            response = ["ok": false, "error": error.localizedDescription]
                        }
                        sema.signal()
                    }
                } else {
                    response = ["ok": false, "error": "Missing action id"]
                    sema.signal()
                }

            case "translate":
                if let text = json["text"] as? String {
                    let target = (json["target"] as? String) ?? Settings.string("lensTarget")
                    Task { @MainActor in
                        let lines = text.components(separatedBy: "\n")
                        let res = await LineTranslator.translate(lines, target: target)
                        var translated: [String] = []
                        for (i, r) in res.enumerated() {
                            switch r {
                            case .text(let t): translated.append(t)
                            case .same: translated.append(lines[i])
                            case .failed: translated.append(lines[i])
                            }
                        }
                        response = ["ok": true, "text": translated.joined(separator: "\n")]
                        sema.signal()
                    }
                } else {
                    response = ["ok": false, "error": "Missing text parameter"]
                    sema.signal()
                }

            default:
                response = ["ok": false, "error": "Unknown command: \(cmd)"]
                sema.signal()
            }
        }

        _ = sema.wait(timeout: .now() + 5.0)
        if let respData = try? JSONSerialization.data(withJSONObject: response),
           var respStr = String(data: respData, encoding: .utf8) {
            respStr.append("\n")
            _ = respStr.withCString { write(clientFd, $0, strlen($0)) }
        }
    }
}

// MARK: - CLI & MCP Runner

enum CLIRunner {
    static func run(arguments: [String]) -> Int32 {
        guard arguments.count > 1 else { return 0 }
        let sub = arguments[1]

        switch sub {
        case "--help", "-h", "help":
            printHelp()
            return 0

        case "rtl":
            let text = readArgOrStdin(arguments: arguments, startIndex: 2)
            if let text = text {
                let transformed = TextTransforms.wrapRtl(text)
                print(transformed)
                return 0
            }
            return 0

        case "flip":
            let text = readArgOrStdin(arguments: arguments, startIndex: 2)
            if let text = text {
                let transformed = TextTransforms.flipKeyboard(text)
                print(transformed)
                return 0
            }
            return 0

        case "show":
            return sendSocketCommand(["cmd": "show"]) ? 0 : 1

        case "history":
            guard let resp = sendSocketQuery(["cmd": "history"]),
                  let ok = resp["ok"] as? Bool, ok else {
                fputs("Error: Could not retrieve history (is TextMonitor running?)\n", stderr)
                return 1
            }
            if let items = resp["items"] as? [[String: Any]] {
                for it in items {
                    let text = (it["text"] as? String) ?? (it["kind"] as? String) ?? ""
                    let id = (it["id"] as? String) ?? ""
                    let time = (it["time"] as? Double) ?? 0
                    print("[\(id)] \(Int(time)) \(text)")
                }
            }
            return 0

        case "action":
            guard arguments.count > 2 else {
                fputs("Error: Missing action id\n", stderr)
                return 1
            }
            let actionId = arguments[2]
            let text = readArgOrStdin(arguments: arguments, startIndex: 3)
            var req: [String: Any] = ["cmd": "action", "id": actionId]
            if let text = text { req["text"] = text }
            guard let resp = sendSocketQuery(req),
                  let ok = resp["ok"] as? Bool, ok else {
                fputs("Error: Action execution failed\n", stderr)
                return 1
            }
            if let res = resp["result"] as? String { print(res) }
            return 0

        case "translate":
            let text = readArgOrStdin(arguments: arguments, startIndex: 2)
            guard let text = text, !text.isEmpty else {
                fputs("Error: Missing text to translate\n", stderr)
                return 1
            }
            guard let resp = sendSocketQuery(["cmd": "translate", "text": text]),
                  let ok = resp["ok"] as? Bool, ok else {
                fputs("Error: Translation failed (is TextMonitor running?)\n", stderr)
                return 1
            }
            if let res = resp["text"] as? String { print(res) }
            return 0

        case "--mcp":
            runMCPServer()
            return 0

        default:
            fputs("Error: Unknown subcommand '\(sub)'. Run 'textmonitor --help' for usage.\n", stderr)
            return 1
        }
    }

    private static func printHelp() {
        let help = """
        TextMonitor v\(AppVersion.version) (\(AppVersion.build))

        Usage: textmonitor <command> [options]

        Commands:
          rtl [text]         Wrap text with RTL isolate marks (or read from stdin)
          flip [text]        Flip keyboard layout between Hebrew and English (or stdin)
          show               Show or toggle the main monitor window
          action <id> [text] Run a Text Action on text
          translate [text]   Translate text to target language
          history            Print recent clipboard history
          --mcp              Run local Model Context Protocol (MCP) JSON-RPC server on stdin/stdout
          --help, help       Show this help message
        """
        print(help)
    }

    private static func readArgOrStdin(arguments: [String], startIndex: Int) -> String? {
        if arguments.count > startIndex {
            return arguments[startIndex...].joined(separator: " ")
        }
        let handle = FileHandle.standardInput
        let data = handle.readDataToEndOfFile()
        if data.isEmpty { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func sendSocketCommand(_ cmd: [String: Any]) -> Bool {
        return sendSocketQuery(cmd) != nil
    }

    private static func sendSocketQuery(_ cmd: [String: Any]) -> [String: Any]? {
        let path = IPCServer.defaultSocketPath()
        guard path.utf8.count <= 104 else {
            fputs("Error: Socket path exceeds 104 bytes\n", stderr)
            return nil
        }

        let fd = socket(AF_UNIX, SOCK_STREAM, 0)
        guard fd >= 0 else { return nil }
        defer { close(fd) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        strncpy(&addr.sun_path.0, path, 103)

        let connRes = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                connect(fd, $0, socklen_t(MemoryLayout<sockaddr_un>.size))
            }
        }
        guard connRes == 0 else {
            fputs("Error: Could not connect to TextMonitor socket (is the app running?)\n", stderr)
            return nil
        }

        guard let data = try? JSONSerialization.data(withJSONObject: cmd) else { return nil }
        var line = String(data: data, encoding: .utf8) ?? ""
        line.append("\n")
        _ = line.withCString { write(fd, $0, strlen($0)) }

        var respData = Data()
        var buf = [UInt8](repeating: 0, count: 4096)
        while true {
            let n = read(fd, &buf, buf.count)
            if n <= 0 { break }
            respData.append(buf, count: n)
            if respData.contains(0x0A) { break }
        }

        guard let obj = (try? JSONSerialization.jsonObject(with: respData)) as? [String: Any] else {
            return nil
        }
        return obj
    }

    // MARK: - MCP Server (JSON-RPC 2.0 over Stdin / Stdout)

    private static func runMCPServer() {
        var lineBuf = Data()
        var buf = [UInt8](repeating: 0, count: 4096)

        while true {
            let n = read(STDIN_FILENO, &buf, buf.count)
            if n <= 0 { break } // EOF

            lineBuf.append(contentsOf: buf[0..<n])
            while let nlIdx = lineBuf.firstIndex(of: 0x0A) {
                let lineData = lineBuf.subdata(in: 0..<nlIdx)
                lineBuf.removeSubrange(0...nlIdx)
                let trimmed = String(data: lineData, encoding: .utf8)?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                if trimmed.isEmpty { continue }

                handleMCPLine(trimmed)
            }
        }
    }

    private static func handleMCPLine(_ raw: String) {
        guard let json = (try? JSONSerialization.jsonObject(with: Data(raw.utf8))) as? [String: Any] else {
            sendMCPError(id: nil, code: -32700, message: "Parse error")
            return
        }

        let rawId = json["id"]
        let method = json["method"] as? String ?? ""

        switch method {
        case "initialize":
            let result: [String: Any] = [
                "protocolVersion": "2024-11-05",
                "capabilities": ["tools": [:] as [String: Any]],
                "serverInfo": ["name": "textmonitor", "version": "1.2.0"]
            ]
            sendMCPResult(id: rawId, result: result)

        case "notifications/initialized":
            // Notification: do not reply
            break

        case "tools/list":
            let tools: [[String: Any]] = [
                [
                    "name": "push_to_monitor",
                    "description": "Pushes new text to the clipboard and TextMonitor history",
                    "inputSchema": [
                        "type": "object",
                        "properties": ["text": ["type": "string", "description": "Text content to push"]],
                        "required": ["text"]
                    ]
                ],
                [
                    "name": "get_clipboard_history",
                    "description": "Retrieves recent clipboard history items from TextMonitor",
                    "inputSchema": [
                        "type": "object",
                        "properties": ["limit": ["type": "integer", "description": "Maximum number of items"]]
                    ]
                ],
                [
                    "name": "get_selected_text",
                    "description": "Reads currently selected text from the frontmost application",
                    "inputSchema": [
                        "type": "object",
                        "properties": [:] as [String: Any]
                    ]
                ],
                [
                    "name": "replace_selected_text",
                    "description": "Replaces currently selected text in the frontmost application",
                    "inputSchema": [
                        "type": "object",
                        "properties": ["text": ["type": "string", "description": "Replacement text"]],
                        "required": ["text"]
                    ]
                ],
                [
                    "name": "translate_text",
                    "description": "Translates text using macOS system translation or configured AI",
                    "inputSchema": [
                        "type": "object",
                        "properties": [
                            "text": ["type": "string", "description": "Source text"],
                            "target": ["type": "string", "description": "Target language code (e.g. he, en)"]
                        ],
                        "required": ["text"]
                    ]
                ],
                [
                    "name": "flip_keyboard_text",
                    "description": "Flips mistyped keyboard layout text between Hebrew and English QWERTY",
                    "inputSchema": [
                        "type": "object",
                        "properties": ["text": ["type": "string", "description": "Text to flip"]],
                        "required": ["text"]
                    ]
                ],
                [
                    "name": "wrap_rtl_text",
                    "description": "Wraps Hebrew lines with Unicode RTL isolate marks for clean BiDi rendering",
                    "inputSchema": [
                        "type": "object",
                        "properties": ["text": ["type": "string", "description": "Text to wrap"]],
                        "required": ["text"]
                    ]
                ]
            ]
            sendMCPResult(id: rawId, result: ["tools": tools])

        case "tools/call":
            let params = json["params"] as? [String: Any]
            let name = params?["name"] as? String ?? ""
            let args = params?["arguments"] as? [String: Any] ?? [:]

            switch name {
            case "flip_keyboard_text":
                guard let text = args["text"] as? String else {
                    sendMCPError(id: rawId, code: -32602, message: "Invalid params: 'text' string required")
                    return
                }
                let flipped = TextTransforms.flipKeyboard(text)
                sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": flipped]]])

            case "wrap_rtl_text":
                guard let text = args["text"] as? String else {
                    sendMCPError(id: rawId, code: -32602, message: "Invalid params: 'text' string required")
                    return
                }
                let wrapped = TextTransforms.wrapRtl(text)
                sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": wrapped]]])

            case "push_to_monitor":
                guard let text = args["text"] as? String else {
                    sendMCPError(id: rawId, code: -32602, message: "Invalid params: 'text' string required")
                    return
                }
                let ok = sendSocketCommand(["cmd": "push", "text": text])
                if ok {
                    sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": "Pushed"]]])
                } else {
                    sendMCPResult(id: rawId, result: [
                        "isError": true,
                        "content": [["type": "text", "text": "Error: Could not reach TextMonitor"]]
                    ])
                }

            case "get_clipboard_history":
                if let resp = sendSocketQuery(["cmd": "history"]), let items = resp["items"] {
                    let jsonText = (try? JSONSerialization.data(withJSONObject: items)).flatMap { String(data: $0, encoding: .utf8) } ?? "[]"
                    sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": jsonText]]])
                } else {
                    sendMCPResult(id: rawId, result: [
                        "isError": true,
                        "content": [["type": "text", "text": "Error: TextMonitor IPC server is not running"]]
                    ])
                }

            case "get_selected_text":
                let sel = SelectionReader.readFrontmostSelection()
                sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": sel?.text ?? ""]]])

            case "replace_selected_text":
                guard let text = args["text"] as? String else {
                    sendMCPError(id: rawId, code: -32602, message: "Invalid params: 'text' string required")
                    return
                }
                let ok = DispatchQueue.main.sync { SelectionWriter.replaceFrontmost(with: text) }
                sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": ok ? "Replaced" : "Failed"]]])

            case "translate_text":
                guard let text = args["text"] as? String else {
                    sendMCPError(id: rawId, code: -32602, message: "Invalid params: 'text' string required")
                    return
                }
                let target = args["target"] as? String
                if let resp = sendSocketQuery(["cmd": "translate", "text": text, "target": target ?? ""]),
                   let tr = resp["text"] as? String {
                    sendMCPResult(id: rawId, result: ["content": [["type": "text", "text": tr]]])
                } else {
                    sendMCPResult(id: rawId, result: [
                        "isError": true,
                        "content": [["type": "text", "text": "Error: Translation failed (is TextMonitor running?)"]]
                    ])
                }

            default:
                sendMCPError(id: rawId, code: -32601, message: "Unknown tool: \(name)")
            }

        default:
            sendMCPError(id: rawId, code: -32601, message: "Method not found: \(method)")
        }
    }

    private static func sendMCPResult(id: Any?, result: [String: Any]) {
        var resp: [String: Any] = ["jsonrpc": "2.0", "result": result]
        if let id = id { resp["id"] = id } else { resp["id"] = NSNull() }
        writeMCPLine(resp)
    }

    private static func sendMCPError(id: Any?, code: Int, message: String) {
        var resp: [String: Any] = [
            "jsonrpc": "2.0",
            "error": ["code": code, "message": message]
        ]
        if let id = id { resp["id"] = id } else { resp["id"] = NSNull() }
        writeMCPLine(resp)
    }

    private static func writeMCPLine(_ obj: [String: Any]) {
        guard let data = try? JSONSerialization.data(withJSONObject: obj),
              var s = String(data: data, encoding: .utf8) else { return }
        s.append("\n")
        fputs(s, stdout)
        fflush(stdout)
    }
}
