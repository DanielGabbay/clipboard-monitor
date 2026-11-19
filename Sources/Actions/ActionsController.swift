import Cocoa
import Carbon
import WebKit
import ApplicationServices

// MARK: - Text Actions & Quick Translate popover
//
// Select text in any app and open the popover (shortcut, the floating button next to the selection, the Services
// menu or the menu bar icon): it opens under the selection, lists the actions, runs the chosen one and shows the
// result in the same place. Quick Translate (⌃⌥T by default) reads the selection or the paragraph under the
// pointer (AXTextReader.textAtPointer) and opens directly in translation view with target selector, collapsible
// source, Copy, Replace (when text was selected), Open in TextMonitor, and Back to all actions. The page is
// Resources/actions.html.
//
// Page -> native: {cmd: "size", h} | {cmd: "close"} | {cmd: "run", id, query?, messages?} | {cmd: "back"}
//                 | {cmd: "copy", text} | {cmd: "replace", text} | {cmd: "setModel", value} | {cmd: "set", key, value}
//                 | {cmd: "open", url} | {cmd: "actions.generate", req, request, existing?} | {cmd: "saveCustomAction", action}
//                 | {cmd: "openInMonitor"} | {cmd: "openAXSettings"} | {cmd: "openAISettings"}
// Native -> page: actions.setup({lang, margin, target, targets}), actions.show({status, ...}), actions.generated(...)
//   status: "reading" | "loading" | "list" {source, actions, models, model, canReplace} | "running" {id, query}
//         | "streaming" {id, text} | "result" {id, text, canReplace}
//         | "quickTranslate" {state, source, text?, detail?, same?, target, targets, canReplace}
//         | "error" {id, detail, code} | "noText" | "secure" | "permission" | "ignored"

private final class ActionsMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: ActionsController?
    init(_ t: ActionsController) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message)
    }
}

/// A borderless panel that takes typing without activating the app.
private final class ActionsPanel: NSPanel {
    var onDigit: ((Int) -> Void)?
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }

    // ⌘ keys would go to the main menu (⌘1 shows / hides the monitors, and there is no Paste item): ⌘1…⌘9 pick an
    // action and the editing keys go to the search field. Key codes, so a Hebrew keyboard layout works too.
    private static let digits = [kVK_ANSI_1, kVK_ANSI_2, kVK_ANSI_3, kVK_ANSI_4, kVK_ANSI_5, kVK_ANSI_6, kVK_ANSI_7, kVK_ANSI_8, kVK_ANSI_9]
    private static let editing: [Int: Selector] = [
        kVK_ANSI_V: #selector(NSText.paste(_:)), kVK_ANSI_X: #selector(NSText.cut(_:)), kVK_ANSI_C: #selector(NSText.copy(_:)),
        kVK_ANSI_A: #selector(NSText.selectAll(_:)), kVK_ANSI_Z: Selector(("undo:")),
    ]

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.type == .keyDown, event.modifierFlags.intersection(.deviceIndependentFlagsMask) == .command {
            let code = Int(event.keyCode)
            if let i = Self.digits.firstIndex(of: code) { onDigit?(i + 1); return true }
            if let action = Self.editing[code] { return NSApp.sendAction(action, to: nil, from: self) }
        }
        return super.performKeyEquivalent(with: event)
    }
}

@MainActor
final class ActionsController: NSObject, WKNavigationDelegate {
    static private(set) var shared: ActionsController?

    static var isOpen: Bool { shared?.panel.isVisible == true }
    static var enabled: Bool { Settings.bool("f.actions") }

    private enum Source { case focused, given(TextSelection), text(String, pid_t) }

    /// Shortcut, menu and menu bar icon: open on the current selection, or close when already open.
    /// `anchor` (global, top-left based) overrides the place; the menu bar icon passes its own frame.
    static func toggle(anchor: CGRect? = nil) {
        if let s = shared, s.panel.isVisible { s.close(); return }
        guard enabled else { return }
        instance().begin(.focused, fixedAnchor: anchor)
    }

    /// The floating button: the selection was already read.
    static func open(_ selection: TextSelection) {
        guard enabled else { return }
        instance().begin(.given(selection), fixedAnchor: nil)
    }

    /// The Services menu: macOS hands over the text.
    /// `targetPid` is the app the text came from (0: unknown, the result can only be copied).
    static func open(text: String, targetPid: pid_t) {
        guard enabled else { return }
        instance().begin(.text(text, targetPid), fixedAnchor: nil)
    }

    /// Translate at Pointer shortcut / menu: translate the selection or hovered paragraph directly, or close if open.
    static func toggleQuickTranslate() {
        if let s = shared, s.panel.isVisible { s.close(); return }
        guard Settings.bool("f.bubble"), Settings.bool("f.translate") else { return }
        instance().beginQuickTranslate()
    }

    private static func instance() -> ActionsController {
        let c = shared ?? ActionsController()
        shared = c
        return c
    }

    static let width: CGFloat = 420
    static let margin: CGFloat = 10      // transparent room around the card for its CSS shadow

    private let panel: ActionsPanel
    private let web: WKWebView
    private var pageReady = false
    private var pending: [String] = []
    private let axQueue = DispatchQueue(label: "clipboard-monitor.actions.ax", qos: .userInitiated)
    private var monitors: [Any] = []
    private var anchor: CGRect = .zero          // global, top-left based
    private var anchorFixed = false
    private var contentHeight: CGFloat = 160
    private var selection: TextSelection?
    private var generation = 0
    private var runTask: Task<Void, Never>?
    private var translationCache: [String: LineResult] = [:]

    private override init() {
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: cfg)
        panel = ActionsPanel(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 200),
                             styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        cfg.userContentController.add(ActionsMessageProxy(self), name: "app")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .popUpMenu
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.sharingType = .none
        panel.contentView = web
        panel.onDigit = { n in MainActor.assumeIsolated { ActionsController.shared?.js("window.actions.pick(\(n))") } }
        if let url = Bundle.main.url(forResource: "actions", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    // MARK: open / close

    private static func pointer() -> CGPoint {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let m = NSEvent.mouseLocation
        return CGPoint(x: m.x, y: primaryHeight - m.y)
    }

    private func sendSetup() {
        let sendTo = (NSApp.delegate as? AppDelegate)?.detectedSendToApps() ?? []
        call("actions.setup", [
            "lang": Loc.lang,
            "margin": Self.margin,
            "target": Settings.string("lensTarget"),
            "targets": Settings.string("translateTargets"),
            "sendToApps": sendTo,
        ])
    }

    private func begin(_ source: Source, fixedAnchor: CGRect?) {
        runTask?.cancel()
        runTask = nil
        SelectionWatcher.shared.hideButton()
        let point = Self.pointer()
        anchor = fixedAnchor ?? CGRect(origin: point, size: .zero)
        anchorFixed = fixedAnchor != nil
        selection = nil
        generation += 1
        let gen = generation
        sendSetup()

        let target = (NSApp.delegate as? AppDelegate)?.externalApp
        switch source {
        case .given(let sel):
            accept(sel)
        case .text(let t, let pid):
            let text = SelectionReader.clean(t)
            guard !text.isEmpty else { present(["status": "noText"], key: true); return }
            accept(TextSelection(text: text, raw: t, anchor: CGRect(origin: point, size: .zero), pid: pid, element: nil))
        case .focused:
            guard AXTextReader.trusted else {
                AXTextReader.requestTrust()
                present(["status": "permission"], key: true)
                return
            }
            if let target, (NSApp.delegate as? AppDelegate)?.isIgnored(target) == true {
                present(["status": "ignored"], key: true)
                return
            }
            // Shown without keyboard focus while reading: a ⌘C fallback must reach the other app, not this panel.
            present(["status": "reading"], key: false)
            let frontPid = target?.processIdentifier
            axQueue.async {
                let result = Self.readSelection(frontPid: frontPid, pointer: point)
                DispatchQueue.main.async { ActionsController.shared?.didRead(result, gen: gen) }
            }
        }
    }

    /// Accessibility first; Chromium / Electron get their tree switched on and a second look; then ⌘C.
    nonisolated static func readSelection(frontPid: pid_t?, pointer: CGPoint) -> SelectionRead {
        let me = getpid()
        var r = SelectionReader.read(frontPid: frontPid, pointer: pointer, excluding: me)
        guard case .none = r, let pid = frontPid, pid != me else { return r }
        if AXTextReader.enableManualAccessibility(pid) {
            Thread.sleep(forTimeInterval: 0.4)
            r = SelectionReader.read(frontPid: frontPid, pointer: pointer, excluding: me)
            if case .none = r {} else { return r }
        }
        var snapshot: PasteboardSnapshot?
        var before = 0
        DispatchQueue.main.sync {
            (NSApp.delegate as? AppDelegate)?.suppressClipboard(for: 2.0)
            snapshot = PasteboardSnapshot.take()
            before = NSPasteboard.general.changeCount
        }
        let copied = SelectionReader.copyFallback()
        DispatchQueue.main.sync {
            if NSPasteboard.general.changeCount != before { snapshot?.restore() }
            (NSApp.delegate as? AppDelegate)?.suppressClipboard(for: 0.8)
        }
        guard let copied else { return .none }
        return .found(TextSelection(text: copied, raw: copied, anchor: CGRect(origin: pointer, size: .zero), pid: pid, element: nil))
    }

    private func beginQuickTranslate() {
        runTask?.cancel()
        runTask = nil
        SelectionWatcher.shared.hideButton()
        let point = Self.pointer()
        anchor = CGRect(origin: point, size: .zero)
        anchorFixed = false
        selection = nil
        generation += 1
        let gen = generation
        sendSetup()

        guard AXTextReader.trusted else {
            AXTextReader.requestTrust()
            present(["status": "permission", "mode": "quickTranslate"], key: true)
            return
        }
        present(["status": "reading", "mode": "quickTranslate"], key: false)
        let frontPid = (NSApp.delegate as? AppDelegate)?.externalApp?.processIdentifier
        axQueue.async {
            let result = Self.readQuickTranslate(frontPid: frontPid, pointer: point)
            DispatchQueue.main.async { ActionsController.shared?.didReadQuickTranslate(result, gen: gen) }
        }
    }

    /// Pointer text (nearby selection or hovered paragraph), with Chromium manual-AX retry and AX-only selection fallback.
    nonisolated private static func readQuickTranslate(frontPid: pid_t?, pointer: CGPoint) -> SelectionRead {
        let me = getpid()
        var found = AXTextReader.textAtPointer(pointer, excluding: me)
        // Chromium / Electron build their tree on request: ask, wait a moment and look again.
        if found == nil,
           let pid = AXTextReader.windowUnder(CGRect(origin: pointer, size: CGSize(width: 1, height: 1)), excluding: me)?.pid,
           pid != me, AXTextReader.enableManualAccessibility(pid) {
            Thread.sleep(forTimeInterval: 0.4)
            found = AXTextReader.textAtPointer(pointer, excluding: me)
        }
        if let found {
            return .found(TextSelection(text: found.text, raw: found.raw, anchor: found.anchor,
                                        pid: found.pid, element: found.element,
                                        canReplace: found.isSelection && found.pid != 0))
        }
        // When opened from the menu bar, the pointer is on the menu bar: fall back to the focused AX selection (never ⌘C).
        return SelectionReader.read(frontPid: frontPid, pointer: pointer, excluding: me)
    }

    private func didReadQuickTranslate(_ result: SelectionRead, gen: Int) {
        guard gen == generation, panel.isVisible else { return }
        switch result {
        case .none:
            present(["status": "noText", "mode": "quickTranslate"], key: true)
        case .secure:
            present(["status": "secure", "mode": "quickTranslate"], key: true)
        case .found(let sel):
            if sel.pid != 0, let app = NSRunningApplication(processIdentifier: sel.pid),
               (NSApp.delegate as? AppDelegate)?.isIgnored(app) == true {
                present(["status": "ignored", "mode": "quickTranslate"], key: true)
                return
            }
            selection = sel
            // A huge anchor (a whole text view) says little about where the text is: stay at the pointer.
            if !anchorFixed, (sel.anchor.width > 0 || sel.anchor.height > 0), sel.anchor.height < 320 {
                anchor = sel.anchor
                if panel.isVisible { place() }
            }
            translateQuick()
        }
    }

    private func translateQuick() {
        guard let sel = selection else { return }
        runTask?.cancel()
        runTask = nil
        generation += 1
        let gen = generation
        let target = Settings.string("lensTarget")
        let targets = Settings.string("translateTargets")
        let key = target + "\u{1}" + sel.text
        if let hit = translationCache[key] {
            showQuickTranslate(hit, sel: sel, target: target, targets: targets)
            return
        }
        present([
            "status": "quickTranslate",
            "state": "translating",
            "source": sel.text,
            "target": target,
            "targets": targets,
            "canReplace": sel.canReplace,
        ], key: true)
        Task { @MainActor in
            let result = await LineTranslator.translate([sel.text], target: target).first ?? .failed("")
            guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { return }
            if case .failed = result {} else {
                if me.translationCache.count > 500 { me.translationCache.removeAll() }
                me.translationCache[key] = result
            }
            me.showQuickTranslate(result, sel: sel, target: target, targets: targets)
        }
    }

    private func showQuickTranslate(_ r: LineResult, sel: TextSelection, target: String, targets: String) {
        var msg: [String: Any] = [
            "status": "quickTranslate",
            "source": sel.text,
            "target": target,
            "targets": targets,
            "canReplace": sel.canReplace,
        ]
        switch r {
        case .text(let t):
            msg["state"] = "ok"
            msg["text"] = t
        case .same:
            msg["state"] = "same"
            msg["same"] = true
            msg["text"] = sel.text
        case .failed(let why):
            msg["state"] = "error"
            msg["detail"] = why
        }
        present(msg, key: true)
    }

    private func didRead(_ result: SelectionRead, gen: Int) {
        guard gen == generation, panel.isVisible else { return }
        switch result {
        case .found(let sel): accept(sel)
        case .secure: present(["status": "secure"], key: true)
        case .none: present(["status": "noText"], key: true)
        }
    }

    private func accept(_ sel: TextSelection) {
        if sel.pid != 0, let app = NSRunningApplication(processIdentifier: sel.pid),
           (NSApp.delegate as? AppDelegate)?.isIgnored(app) == true {
            present(["status": "ignored"], key: true)
            return
        }
        selection = sel
        // A huge anchor (a whole text view) says little about where the text is: stay at the pointer.
        if !anchorFixed, sel.anchor.width > 0, sel.anchor.height > 0, sel.anchor.height < 320 {
            anchor = sel.anchor
            if panel.isVisible { place() }
        }
        showList()
    }

    private func showList() {
        guard let sel = selection else { return }
        let current = TextActions.model().map { $0.providerId + "\n" + $0.model } ?? ""
        present(["status": "list", "source": sel.text, "actions": TextActions.listForPage(),
                 "models": TextActions.modelsForPage(), "model": current, "canReplace": sel.canReplace], key: true)
    }

    private func run(_ id: String, query: String?, messages: [[String: String]]? = nil) {
        guard let sel = selection else { return }
        runTask?.cancel()
        runTask = nil
        generation += 1
        let gen = generation
        let appName = sel.pid != 0 ? NSRunningApplication(processIdentifier: sel.pid)?.localizedName : nil
        let started = Date()
        // The log entry; the request is kept even when the popover was closed before the answer came.
        var entry: [String: Any] = ["action": id, "query": query ?? "", "app": appName ?? "", "source": sel.text,
                                    "title": TextActions.library().first { $0.id == id }?.name ?? ""]
        if let localOut = TextActions.runLocal(id: id, text: sel.text) {
            entry["result"] = localOut
            entry["model"] = ""
            entry["ms"] = 0
            ActionLog.add(entry)
            present(["status": "result", "id": id, "text": localOut, "canReplace": sel.canReplace], key: true)
            return
        }
        present(["status": "running", "id": id, "query": query ?? ""], key: true)
        if id.hasPrefix("translate:") && (messages == nil || messages!.isEmpty) {
            runTask = Task { @MainActor in
                do {
                    let res = try await TextActions.run(id: id, query: query, text: sel.text, app: appName)
                    try Task.checkCancellation()
                    let out = res.text
                    entry["result"] = out; entry["model"] = res.model
                    entry["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                    ActionLog.add(entry)
                    guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { return }
                    me.present(["status": "result", "id": id, "text": out, "canReplace": sel.canReplace], key: true)
                } catch {
                    if error is CancellationError || Task.isCancelled { return }
                    entry["error"] = error.localizedDescription
                    entry["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                    ActionLog.add(entry)
                    guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { return }
                    let code = (error as? ActionFailure)?.code ?? ""
                    me.present(["status": "error", "id": id, "detail": error.localizedDescription, "code": code], key: true)
                }
            }
            return
        }
        runTask = Task { @MainActor in
            do {
                let (stream, modelName) = try TextActions.runStream(id: id, query: query, messages: messages, text: sel.text, app: appName)
                var accumulated = ""
                var lastEmit = Date.distantPast
                var didEmitStream = false
                for try await chunk in stream {
                    try Task.checkCancellation()
                    accumulated += chunk
                    let now = Date()
                    if !accumulated.isEmpty && (!didEmitStream || now.timeIntervalSince(lastEmit) >= 0.05) {
                        guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { break }
                        didEmitStream = true
                        lastEmit = now
                        me.call("actions.show", ["status": "streaming", "id": id, "text": accumulated])
                    }
                }
                try Task.checkCancellation()
                let result = accumulated.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !result.isEmpty else { throw ActionFailure(code: "", message: "The model returned an empty answer") }
                entry["result"] = result; entry["model"] = modelName
                entry["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                ActionLog.add(entry)
                guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { return }
                me.present(["status": "result", "id": id, "text": result, "canReplace": sel.canReplace], key: true)
            } catch {
                if error is CancellationError || Task.isCancelled { return }
                entry["error"] = error.localizedDescription
                entry["ms"] = Int(Date().timeIntervalSince(started) * 1000)
                ActionLog.add(entry)
                guard let me = ActionsController.shared, me === self, gen == me.generation, me.panel.isVisible else { return }
                let code = (error as? ActionFailure)?.code ?? ""
                me.present(["status": "error", "id": id, "detail": error.localizedDescription, "code": code], key: true)
            }
        }
    }

    /// Writes `text` over the selection: through accessibility when the app allows it, else by pasting.
    private func replace(with text: String) {
        guard let sel = selection, sel.canReplace, sel.pid != 0 else { return }
        close()
        axQueue.async {
            let done = SelectionWriter.replaceViaAccessibility(sel, with: text)
            if !done { DispatchQueue.main.async { SelectionWriter.replaceViaPaste(pid: sel.pid, with: text) } }
        }
    }

    func close() {
        runTask?.cancel()
        runTask = nil
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
        selection = nil
        generation += 1
        panel.orderOut(nil)
    }

    /// Shows the popover (first call places it) and sends its content. `key` gives it the keyboard.
    private func present(_ msg: [String: Any], key: Bool) {
        call("actions.show", msg)
        if !panel.isVisible {
            place()
            panel.orderFrontRegardless()
            installMonitors()
        }
        if key, !panel.isKeyWindow {
            panel.makeKey()
            panel.makeFirstResponder(web)
        }
    }

    private func installMonitors() {
        guard monitors.isEmpty else { return }
        // A click anywhere else closes the popover.
        if let g = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown], handler: { _ in
            DispatchQueue.main.async { ActionsController.shared?.close() }
        }) { monitors.append(g) }
    }

    // MARK: placement

    /// Below the anchor, or above it when there is no room, inside the visible frame of the anchor's screen.
    private func place() {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let a = NSRect(x: anchor.minX, y: primaryHeight - anchor.maxY, width: anchor.width, height: anchor.height)
        let screen = NSScreen.screens.first { $0.frame.contains(NSPoint(x: a.midX, y: a.midY)) } ?? NSScreen.main ?? NSScreen.screens.first
        guard let vf = screen?.visibleFrame else { return }
        let w = min(Self.width, vf.width - 16) + Self.margin * 2
        let h = min(contentHeight + Self.margin * 2, vf.height * 0.7)
        var x = a.minX - Self.margin
        x = max(vf.minX + 4, min(x, vf.maxX - w - 4))
        var y = a.minY - 6 - h + Self.margin            // below the anchor (Cocoa y grows upward)
        if y < vf.minY + 4 { y = a.maxY + 6 - Self.margin }   // no room below: above it
        y = max(vf.minY + 4, min(y, vf.maxY - h - 4))
        panel.setFrame(NSRect(x: x, y: y, width: w, height: h), display: true)
    }

    // MARK: page bridge

    private func js(_ code: String) {
        if pageReady { web.evaluateJavaScript(code, completionHandler: nil) } else { pending.append(code) }
    }

    private func call(_ fn: String, _ arg: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: arg), let json = String(data: data, encoding: .utf8) else { return }
        js("window.\(fn)(\(json))")
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let queued = pending; pending.removeAll()
        queued.forEach { web.evaluateJavaScript($0, completionHandler: nil) }
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url {
            if let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" || scheme == "mailto" {
                NSWorkspace.shared.open(url)
            }
            decisionHandler(.cancel)
            return
        }
        decisionHandler(.allow)
    }

    fileprivate func handle(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        let app = NSApp.delegate as? AppDelegate
        switch cmd {
        case "size":
            if let h = body["h"] as? Double, abs(CGFloat(h) - contentHeight) > 1 {
                contentHeight = CGFloat(h)
                if panel.isVisible { place() }
            }
        case "close": close()
        case "run":
            if let id = body["id"] as? String {
                let rawMsgs = body["messages"] as? [[String: Any]]
                let msgs: [[String: String]]? = rawMsgs?.compactMap { m in
                    guard let role = m["role"] as? String, let content = m["content"] as? String else { return nil }
                    return ["role": role, "content": content]
                }
                run(id, query: body["query"] as? String, messages: msgs)
            }
        case "back":
            runTask?.cancel()
            runTask = nil
            generation += 1
            showList()
        case "copy":
            if let t = body["text"] as? String { app?.writeClipboard(t) }
            close()
        case "sendTo":
            if let target = body["app"] as? String, let text = body["text"] as? String {
                app?.sendText(text, toApp: target)
                close()
            }
        case "replace":
            if let t = body["text"] as? String { replace(with: t) }
        case "open":
            if let s = body["url"] as? String, let url = URL(string: s),
               let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" || scheme == "mailto" {
                NSWorkspace.shared.open(url)
            }
        case "actions.generate":
            let req = (body["req"] as? String) ?? ""
            let request = (body["request"] as? String) ?? ""
            let existing = body["existing"] as? [String: Any]
            Task { @MainActor [weak self] in
                do {
                    let action = try await TextActions.generateAction(request: request, existing: existing)
                    self?.call("actions.generated", ["req": req, "action": action])
                } catch {
                    let code = (error as? ActionFailure)?.code ?? ""
                    self?.call("actions.generated", ["req": req, "error": error.localizedDescription, "code": code])
                }
            }
        case "saveCustomAction":
            _ = TextActions.saveCustomAction(body)
        case "setModel":
            if let v = body["value"] as? String {
                let parts = v.components(separatedBy: "\n")
                app?.setSetting("actionsProvider", parts.first ?? "")
                app?.setSetting("actionsModel", parts.dropFirst().joined(separator: "\n"))
            }
        case "set":
            if let k = body["key"] as? String, let v = body["value"] {
                app?.setSetting(k, v)
                if k == "lensTarget", selection != nil { translateQuick() }
            }
        case "openInMonitor": openInMonitor()
        case "openAXSettings": AXTextReader.openAccessibilitySettings(); close()
        case "openAISettings":
            close()
            app?.openSettings(nil)
            app?.current?.js("(function(){var b=document.querySelector('#settings .tabs [data-tab=\"ai\"]');if(b)b.click();})()")
            NSApp.activate(ignoringOtherApps: true)
        default: break
        }
    }

    /// Puts the source text in the TextMonitor history and translates it there with the same target.
    private func openInMonitor() {
        guard let sel = selection, let d = NSApp.delegate as? AppDelegate else { return }
        var item: [String: Any] = [
            "id": UUID().uuidString,
            "time": Date().timeIntervalSince1970 * 1000,
            "kind": "text",
            "text": sel.text,
            "translateTo": Settings.string("lensTarget"),
        ]
        if sel.pid != 0, let appName = NSRunningApplication(processIdentifier: sel.pid)?.localizedName {
            item["app"] = appName
        }
        if d.controllers.isEmpty { d.newWindow(nil) }
        d.controllers.forEach { $0.call("monitor.push", item) }
        d.current?.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        close()
    }
}
