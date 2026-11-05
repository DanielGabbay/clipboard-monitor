import Cocoa
import WebKit
import ApplicationServices

// MARK: - Translation Lens
//
// A floating, see-through panel. The text of the window under it is read from that app's accessibility tree
// (AXTextReader), translated line by line (LineTranslator) and drawn by Resources/lens.html on top of each
// original line. The panel's toolbar strip and its edges take the mouse (drag, resize, buttons); everywhere else
// clicks and scrolling pass through to the app below.
//
// Page -> native: {cmd: "ready" | "dragZones" | "set" | "refresh" | "close" | "openAXSettings"}
// Native -> page: lens.setup({lang, target, targets, auto}), lens.render({spans: [{x, y, w, h, line, text}], status, detail?}),
//                 lens.status({status, detail?}), lens.clear()
//   status: "permission" | "noWindow" | "ignored" | "empty" | "reading" | "translating" | "ok" | "error"

/// WKUserContentController retains its handler; this proxy lets the lens deallocate.
private final class LensMessageProxy: NSObject, WKScriptMessageHandler {
    weak var target: LensController?
    init(_ t: LensController) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message)
    }
}

@MainActor
final class LensController: NSObject, NSWindowDelegate, WKNavigationDelegate {
    static private(set) var shared: LensController?

    static var isOpen: Bool { shared != nil }

    static func toggle() {
        if let s = shared { s.close() } else { open() }
    }

    static func open() {
        guard shared == nil, Settings.bool("f.lens"), Settings.bool("f.translate") else { return }
        let c = LensController()
        shared = c
        c.show()
    }

    /// CSS px of the toolbar strip at the top of lens.html. The text region starts below it.
    static let headerHeight: CGFloat = 30
    static let edge: CGFloat = 6
    static let autoInterval: TimeInterval = 1.5

    let panel: NSPanel
    let web: DragWebView
    private var pageReady = false
    private var pending: [String] = []

    private let readQueue = DispatchQueue(label: "clipboard-monitor.lens.ax", qos: .userInitiated)
    private var reading = false
    private var readAgain = false
    private var generation = 0
    private var lastSpans: [LensSpan]?
    private var lastRegion: CGRect = .null
    private var lastTarget: LensTarget?
    private var cache: [String: LineResult] = [:]   // "<target>\u{1}<text>"

    private var debounce: Timer?
    private var ticker: Timer?
    private var mouseMonitors: [Any] = []
    private var observer: AXObserver?
    private var observedApp: AXUIElement?
    private var observedPid: pid_t = 0
    private var activationObs: NSObjectProtocol?
    private var askedForTrust = false

    private override init() {
        let cfg = WKWebViewConfiguration()
        web = DragWebView(frame: .zero, configuration: cfg)
        panel = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 560, height: 280),
                        styleMask: [.titled, .resizable, .fullSizeContentView, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        super.init()
        cfg.userContentController.add(LensMessageProxy(self), name: "app")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.headerHeight = Self.headerHeight

        panel.title = "Translation Lens"
        panel.titlebarAppearsTransparent = true
        panel.titleVisibility = .hidden
        [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].forEach { panel.standardWindowButton($0)?.isHidden = true }
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.becomesKeyOnlyIfNeeded = true
        panel.hidesOnDeactivate = false
        panel.acceptsMouseMovedEvents = true
        panel.isReleasedWhenClosed = false
        panel.sharingType = .none            // never part of screenshots or screen sharing
        panel.minSize = NSSize(width: 220, height: 90)
        panel.contentView = web
        panel.delegate = self
        if !panel.setFrameUsingName("TranslationLens") { panel.center() }
        panel.setFrameAutosaveName("TranslationLens")

        if let url = Bundle.main.url(forResource: "lens", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    private func show() {
        panel.orderFrontRegardless()
        installMouseTracking()
        activationObs = NSWorkspace.shared.notificationCenter.addObserver(
            forName: NSWorkspace.didActivateApplicationNotification, object: nil, queue: .main) { _ in
            DispatchQueue.main.async { LensController.shared?.scheduleRefresh(0.3) }
        }
        restartTicker()
        scheduleRefresh(0.05)
    }

    func close() {
        debounce?.invalidate(); ticker?.invalidate()
        mouseMonitors.forEach { NSEvent.removeMonitor($0) }
        mouseMonitors.removeAll()
        if let o = activationObs { NSWorkspace.shared.notificationCenter.removeObserver(o) }
        stopObserving()
        web.configuration.userContentController.removeScriptMessageHandler(forName: "app")
        panel.delegate = nil
        panel.orderOut(nil)
        if Self.shared === self { Self.shared = nil }
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
        sendSetup()
        let queued = pending; pending.removeAll()
        queued.forEach { web.evaluateJavaScript($0, completionHandler: nil) }
    }

    private func sendSetup() {
        call("lens.setup", ["lang": Loc.lang, "target": Settings.string("lensTarget"),
                            "targets": Settings.string("translateTargets"), "auto": Settings.bool("lensAutoRefresh")])
    }

    fileprivate func handle(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "dragZones":
            if let h = body["header"] as? Double { web.headerHeight = h }
            if let rects = body["controls"] as? [[Double]] {
                web.controls = rects.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            }
        case "set":
            if let k = body["key"] as? String, let v = body["value"] { (NSApp.delegate as? AppDelegate)?.setSetting(k, v) }
        case "refresh": forceRefresh()
        case "close": close()
        case "openAXSettings": AXTextReader.openAccessibilitySettings()
        default: break
        }
    }

    /// Called by AppDelegate after any settings change.
    func settingsChanged() {
        guard Settings.bool("f.lens"), Settings.bool("f.translate") else { close(); return }
        sendSetup()
        restartTicker()
        forceRefresh()
    }

    // MARK: window

    func windowDidMove(_ notification: Notification) { moved() }
    func windowDidResize(_ notification: Notification) { moved() }

    private func moved() {
        call("lens.clear", [:] as [String: Any])
        lastSpans = nil
        scheduleRefresh(0.35)
    }

    /// The text region (below the toolbar) in global top-left coordinates.
    private func textRegion() -> CGRect {
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let f = panel.frame
        let header = Self.headerHeight * web.pageZoom
        return CGRect(x: f.minX, y: primaryHeight - f.maxY + header, width: f.width, height: max(0, f.height - header))
    }

    // MARK: mouse: the text region lets clicks and scrolling through

    private func installMouseTracking() {
        if let g = NSEvent.addGlobalMonitorForEvents(matching: [.mouseMoved, .leftMouseDragged], handler: { _ in
            DispatchQueue.main.async { LensController.shared?.updatePassThrough() }
        }) { mouseMonitors.append(g) }
        if let l = NSEvent.addLocalMonitorForEvents(matching: [.mouseMoved], handler: { e in
            DispatchQueue.main.async { LensController.shared?.updatePassThrough() }
            return e
        }) { mouseMonitors.append(l) }
    }

    private func updatePassThrough() {
        let p = NSEvent.mouseLocation
        let f = panel.frame
        var pass = false
        if f.contains(p) {
            let header = Self.headerHeight * web.pageZoom
            let inHeader = p.y >= f.maxY - header
            let nearEdge = p.x < f.minX + Self.edge || p.x > f.maxX - Self.edge || p.y < f.minY + Self.edge
            pass = !inHeader && !nearEdge
        }
        if panel.ignoresMouseEvents != pass { panel.ignoresMouseEvents = pass }
    }

    // MARK: refresh scheduling

    private func restartTicker() {
        ticker?.invalidate(); ticker = nil
        guard Settings.bool("lensAutoRefresh") else { return }
        ticker = Timer.scheduledTimer(withTimeInterval: Self.autoInterval, repeats: true) { _ in
            DispatchQueue.main.async { LensController.shared?.refresh() }
        }
    }

    func scheduleRefresh(_ delay: TimeInterval = 0.4) {
        debounce?.invalidate()
        debounce = Timer.scheduledTimer(withTimeInterval: delay, repeats: false) { _ in
            DispatchQueue.main.async { LensController.shared?.refresh() }
        }
    }

    /// The refresh button: read again even if nothing seems to have changed.
    private func forceRefresh() {
        lastSpans = nil
        scheduleRefresh(0.05)
    }

    /// Something changed in the app under the lens (accessibility notification).
    fileprivate func contentChanged() {
        guard Settings.bool("lensAutoRefresh") else { return }
        scheduleRefresh(0.45)
    }

    // MARK: read -> translate -> render

    private func refresh() {
        guard panel.isVisible else { return }
        guard AXTextReader.trusted else {
            if !askedForTrust { askedForTrust = true; AXTextReader.requestTrust() }
            call("lens.status", ["status": "permission"])
            return
        }
        if reading { readAgain = true; return }
        let region = textRegion()
        guard region.height > 4, let target = AXTextReader.windowUnder(region, excluding: getpid()) else {
            lastSpans = nil
            call("lens.render", ["spans": [] as [Any], "status": "noWindow"] as [String: Any])
            return
        }
        if let app = NSRunningApplication(processIdentifier: target.pid), (NSApp.delegate as? AppDelegate)?.isIgnored(app) == true {
            lastSpans = nil
            stopObserving()
            call("lens.render", ["spans": [] as [Any], "status": "ignored"] as [String: Any])
            return
        }
        if Settings.bool("lensAutoRefresh") { observe(target.pid) } else { stopObserving() }

        reading = true
        if lastSpans == nil { call("lens.status", ["status": "reading"]) }
        readQueue.async {
            let firstTime = AXTextReader.enableManualAccessibility(target.pid)
            let spans = AXTextReader.read(target, region: region)
            DispatchQueue.main.async {
                LensController.shared?.didRead(spans, region: region, target: target, treeJustEnabled: firstTime)
            }
        }
    }

    private func didRead(_ spans: [LensSpan], region: CGRect, target: LensTarget, treeJustEnabled: Bool) {
        reading = false
        if readAgain { readAgain = false; scheduleRefresh(0.05) }
        // Chromium / Electron build their tree after the first request: look again shortly.
        if treeJustEnabled && spans.isEmpty { scheduleRefresh(0.8) }
        // Same text in the same place: nothing to do (the timer lands here most of the time).
        if let last = lastSpans, last == spans, region == lastRegion, target == lastTarget { return }
        lastSpans = spans; lastRegion = region; lastTarget = target
        generation += 1
        let gen = generation
        let lang = Settings.string("lensTarget")
        render(spans, region: region, lang: lang, status: spans.isEmpty ? "empty" : nil)
        guard !spans.isEmpty else { return }

        let missing = Array(Set(spans.map(\.text).filter { cache[key(lang, $0)] == nil }))
        guard !missing.isEmpty else { return }
        call("lens.status", ["status": "translating"])
        Task { @MainActor in
            let results = await LineTranslator.translate(missing, target: lang)
            guard let me = LensController.shared, me === self else { return }
            if me.cache.count > 3000 { me.cache.removeAll() }
            var errors: [String] = []
            for (text, r) in zip(missing, results) {
                if case .failed(let why) = r { errors.append(why) } else { me.cache[me.key(lang, text)] = r }
            }
            guard gen == me.generation else { return }
            let status = errors.isEmpty ? nil : "error"
            me.render(spans, region: region, lang: lang, status: status, detail: errors.first)
        }
    }

    private func key(_ lang: String, _ text: String) -> String { lang + "\u{1}" + text }

    private func render(_ spans: [LensSpan], region: CGRect, lang: String, status: String?, detail: String? = nil) {
        let z = web.pageZoom
        var items: [[String: Any]] = []
        for s in spans {
            guard case .text(let t)? = cache[key(lang, s.text)] else { continue }
            items.append(["x": (s.rect.minX - region.minX) / z, "y": (s.rect.minY - region.minY) / z,
                          "w": s.rect.width / z, "h": s.rect.height / z, "line": s.singleLine, "text": t])
        }
        var msg: [String: Any] = ["spans": items, "status": status ?? (items.isEmpty && !spans.isEmpty ? "translating" : "ok")]
        if let detail, !detail.isEmpty { msg["detail"] = detail }
        call("lens.render", msg)
    }

    // MARK: accessibility notifications from the app under the lens

    private static let notifications = [kAXValueChangedNotification, kAXFocusedUIElementChangedNotification,
                                        kAXSelectedTextChangedNotification, kAXWindowMovedNotification,
                                        kAXWindowResizedNotification, kAXLayoutChangedNotification,
                                        kAXFocusedWindowChangedNotification, kAXSelectedChildrenChangedNotification]

    private func observe(_ pid: pid_t) {
        guard pid != observedPid else { return }
        stopObserving()
        var created: AXObserver?
        let callback: AXObserverCallback = { _, _, _, _ in
            DispatchQueue.main.async { LensController.shared?.contentChanged() }
        }
        guard AXObserverCreate(pid, callback, &created) == .success, let obs = created else { return }
        let app = AXUIElementCreateApplication(pid)
        for n in Self.notifications { AXObserverAddNotification(obs, app, n as CFString, nil) }
        CFRunLoopAddSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        observer = obs; observedApp = app; observedPid = pid
    }

    private func stopObserving() {
        if let obs = observer {
            if let app = observedApp { for n in Self.notifications { AXObserverRemoveNotification(obs, app, n as CFString) } }
            CFRunLoopRemoveSource(CFRunLoopGetMain(), AXObserverGetRunLoopSource(obs), .defaultMode)
        }
        observer = nil; observedApp = nil; observedPid = 0
    }
}
