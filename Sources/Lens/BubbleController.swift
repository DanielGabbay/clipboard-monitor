import Cocoa
import WebKit
import ApplicationServices

// MARK: - Translate at Pointer
//
// A shortcut (⌃⌥T by default) translates what the user points at in any app: the selection when the pointer is on
// it, else the paragraph under the pointer, read from the accessibility tree (AXTextReader.textAtPointer). The
// translation opens in a small card next to the text (Resources/bubble.html). No clipboard is involved.
//
// Page -> native: {cmd: "size", h} | {cmd: "close"} | {cmd: "copy", text} | {cmd: "open"} | {cmd: "set", key, value}
//                 | {cmd: "openAXSettings"}
// Native -> page: bubble.setup({lang, target, targets}), bubble.show({status, source?, text?, detail?})
//   status: "reading" | "translating" | "ok" | "same" | "error" | "noText" | "permission" | "ignored"

private final class BubbleMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: BubbleController?
    init(_ t: BubbleController) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message)
    }
}

/// A borderless panel that can take Esc without activating the app.
private final class BubblePanel: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

@MainActor
final class BubbleController: NSObject, WKNavigationDelegate {
    static private(set) var shared: BubbleController?

    static var isOpen: Bool { shared?.panel.isVisible == true }

    /// The shortcut: open at the pointer, or close when already open.
    static func toggle() {
        if let s = shared, s.panel.isVisible { s.close(); return }
        guard Settings.bool("f.bubble"), Settings.bool("f.translate") else { return }
        let c = shared ?? BubbleController()
        shared = c
        c.begin()
    }

    static let width: CGFloat = 440
    static let margin: CGFloat = 10      // transparent room around the card for its CSS shadow

    private let panel: BubblePanel
    private let web: WKWebView
    private var pageReady = false
    private var pending: [String] = []
    private let readQueue = DispatchQueue(label: "clipboard-monitor.bubble.ax", qos: .userInitiated)
    private var monitors: [Any] = []
    private var anchor: CGRect = .zero          // global, top-left based
    private var contentHeight: CGFloat = 120
    private var source: PointerSource?
    private var translation: String?
    private var generation = 0
    private var cache: [String: LineResult] = [:]

    private struct PointerSource { let text: String; let appName: String? }

    private override init() {
        let cfg = WKWebViewConfiguration()
        web = WKWebView(frame: .zero, configuration: cfg)
        panel = BubblePanel(contentRect: NSRect(x: 0, y: 0, width: Self.width, height: 160),
                            styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
        super.init()
        cfg.userContentController.add(BubbleMessageProxy(self), name: "app")
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
        if let url = Bundle.main.url(forResource: "bubble", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    // MARK: open / close

    private func begin() {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let m = NSEvent.mouseLocation
        let point = CGPoint(x: m.x, y: primaryHeight - m.y)
        anchor = CGRect(origin: point, size: .zero)
        source = nil; translation = nil
        generation += 1
        let gen = generation
        sendSetup()

        guard AXTextReader.trusted else {
            AXTextReader.requestTrust()
            present(["status": "permission"])
            return
        }
        present(["status": "reading"])
        let me = getpid()
        readQueue.async {
            var found = AXTextReader.textAtPointer(point, excluding: me)
            // Chromium / Electron build their tree on request: ask, wait a moment and look again.
            if found == nil, let pid = Self.pidAt(point), pid != me, AXTextReader.enableManualAccessibility(pid) {
                Thread.sleep(forTimeInterval: 0.4)
                found = AXTextReader.textAtPointer(point, excluding: me)
            }
            let result = found
            DispatchQueue.main.async { BubbleController.shared?.didRead(result, gen: gen) }
        }
    }

    /// The pid of the window under the point, without the accessibility tree.
    nonisolated private static func pidAt(_ p: CGPoint) -> pid_t? {
        AXTextReader.windowUnder(CGRect(origin: p, size: CGSize(width: 1, height: 1)), excluding: getpid())?.pid
    }

    private func didRead(_ found: AXTextReader.PointerText?, gen: Int) {
        guard gen == generation, panel.isVisible else { return }
        guard let found else { present(["status": "noText"]); return }
        let app = NSRunningApplication(processIdentifier: found.pid)
        if let app, (NSApp.delegate as? AppDelegate)?.isIgnored(app) == true { present(["status": "ignored"]); return }
        // A huge anchor (a whole text view) says little about where the text is: stay at the pointer.
        if found.anchor.width > 0 || found.anchor.height > 0, found.anchor.height < 320 { anchor = found.anchor }
        source = PointerSource(text: found.text, appName: app?.localizedName)
        translate()
    }

    private func translate() {
        guard let src = source else { return }
        generation += 1
        let gen = generation
        let target = Settings.string("lensTarget")
        let key = target + "\u{1}" + src.text
        if let hit = cache[key] { show(hit, src); return }
        present(["status": "translating", "source": src.text])
        Task { @MainActor in
            let result = await LineTranslator.translate([src.text], target: target).first ?? .failed("")
            guard let me = BubbleController.shared, me === self, gen == me.generation else { return }
            if case .failed = result {} else {
                if me.cache.count > 500 { me.cache.removeAll() }
                me.cache[key] = result
            }
            me.show(result, src)
        }
    }

    private func show(_ r: LineResult, _ src: PointerSource) {
        switch r {
        case .text(let t): translation = t; present(["status": "ok", "source": src.text, "text": t])
        case .same: translation = src.text; present(["status": "same", "source": src.text, "text": src.text])
        case .failed(let why): translation = nil; present(["status": "error", "source": src.text, "detail": why])
        }
    }

    func close() {
        monitors.forEach { NSEvent.removeMonitor($0) }
        monitors.removeAll()
        generation += 1
        panel.orderOut(nil)
    }

    /// Shows the card (first call places it) and sends its content.
    private func present(_ msg: [String: Any]) {
        call("bubble.show", msg)
        if !panel.isVisible {
            place()
            panel.orderFrontRegardless()
            panel.makeKey()
            installMonitors()
        }
    }

    private func installMonitors() {
        guard monitors.isEmpty else { return }
        // A click or a scroll anywhere else closes the card.
        if let g = NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown, .scrollWheel], handler: { _ in
            DispatchQueue.main.async { BubbleController.shared?.close() }
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
        let h = min(contentHeight + Self.margin * 2, vf.height * 0.6)
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

    private func sendSetup() {
        call("bubble.setup", ["lang": Loc.lang, "target": Settings.string("lensTarget"),
                              "targets": Settings.string("translateTargets"), "margin": Self.margin])
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let queued = pending; pending.removeAll()
        queued.forEach { web.evaluateJavaScript($0, completionHandler: nil) }
    }

    fileprivate func handle(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "size":
            if let h = body["h"] as? Double, abs(CGFloat(h) - contentHeight) > 1 {
                contentHeight = CGFloat(h)
                if panel.isVisible { place() }
            }
        case "close": close()
        case "copy":
            if let t = body["text"] as? String { (NSApp.delegate as? AppDelegate)?.writeClipboard(t) }
        case "open": openInMonitor()
        case "set":
            if let k = body["key"] as? String, let v = body["value"] {
                (NSApp.delegate as? AppDelegate)?.setSetting(k, v)
                if k == "lensTarget" { translate() }
            }
        case "openAXSettings": AXTextReader.openAccessibilitySettings(); close()
        default: break
        }
    }

    /// Puts the source text in the Clipboard Monitor history and translates it there with the same target.
    private func openInMonitor() {
        guard let src = source, let d = NSApp.delegate as? AppDelegate else { return }
        var item: [String: Any] = ["id": UUID().uuidString, "time": Date().timeIntervalSince1970 * 1000,
                                   "kind": "text", "text": src.text, "translateTo": Settings.string("lensTarget")]
        if let app = src.appName { item["app"] = app }
        if d.controllers.isEmpty { d.newWindow(nil) }
        d.controllers.forEach { $0.call("monitor.push", item) }
        d.current?.window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        close()
    }
}
