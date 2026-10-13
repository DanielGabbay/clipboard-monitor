// Clipboard Monitor: small always-visible windows that show the clipboard with correct Hebrew/English (BiDi)
// rendering, and render Markdown / rich text / code. AppKit shell + one WKWebView per window (or tab).
// Rendering and the settings panel live in Resources/index.html; Resources/bidi-fix.js is the BiDi engine.
import Cocoa
import WebKit
import Carbon
import ServiceManagement

// MARK: - Settings

/// Every setting lives in UserDefaults as "s.<key>". The page sees the whole dictionary; keys it does not
/// know about are native-only. Older builds stored a few keys without the prefix; those are still honoured.
enum Settings {
    static let d = UserDefaults.standard
    static let defaults: [String: Any] = [
        // window & app
        "onTop": false, "allSpaces": false, "theme": "system", "zoom": 1.0, "hotkey": "ctrl-opt-v",
        // history & privacy
        "keepHistory": true, "maxHistory": 50, "ignoredApps": "",
        // rendering (used by the page)
        "detect": "majority", "ratio": 0.3, "rich": true, "markdown": true, "highlight": true, "images": true,
        "font": "system",
    ]
    static func get(_ k: String) -> Any { d.object(forKey: "s." + k) ?? d.object(forKey: k) ?? defaults[k] ?? NSNull() }
    static func set(_ k: String, _ v: Any) { d.set(v, forKey: "s." + k) }
    static func bool(_ k: String) -> Bool { (get(k) as? NSNumber)?.boolValue ?? false }
    static func double(_ k: String) -> Double { (get(k) as? NSNumber)?.doubleValue ?? 0 }
    static func string(_ k: String) -> String { get(k) as? String ?? "" }
    static var all: [String: Any] { var r: [String: Any] = [:]; for k in defaults.keys { r[k] = get(k) }; return r }
}

/// Global show/hide shortcuts offered in Settings. Carbon hot keys need no Accessibility permission.
let hotKeyPresets: [String: (key: Int, mods: Int)] = [
    "ctrl-opt-v": (kVK_ANSI_V, controlKey | optionKey),
    "ctrl-opt-cmd-v": (kVK_ANSI_V, controlKey | optionKey | cmdKey),
    "ctrl-shift-v": (kVK_ANSI_V, controlKey | shiftKey),
    "ctrl-opt-space": (kVK_Space, controlKey | optionKey),
]

// MARK: - Web view that lets its header drag the window

// The page fills the whole window, including the (transparent) title bar, so AppKit never sees a title-bar
// drag. A press in the page header that is not on a control moves the window; a double-click zooms it.
final class DragWebView: WKWebView {
    var headerHeight: CGFloat = 38      // CSS px, from the page
    var controls: [CGRect] = []         // CSS px, header controls that must keep their clicks

    override func mouseDown(with event: NSEvent) {
        var p = convert(event.locationInWindow, from: nil)
        if !isFlipped { p.y = bounds.height - p.y }
        let css = CGPoint(x: p.x / pageZoom, y: p.y / pageZoom)
        if css.y <= headerHeight, !controls.contains(where: { $0.contains(css) }) {
            if event.clickCount == 2 { window?.performZoom(nil) } else { window?.performDrag(with: event) }
            return
        }
        super.mouseDown(with: event)
    }
}

/// WKUserContentController retains its handler; this proxy keeps windows free to deallocate.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: MonitorController?
    init(_ t: MonitorController) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.handle(message)
    }
}

// MARK: - One monitor window (or tab)

final class MonitorController: NSObject, NSWindowDelegate, WKNavigationDelegate {
    unowned let app: AppDelegate
    let slot: Int
    let window: NSWindow
    let web: DragWebView
    var pageReady = false
    var pending: [String] = []          // JS calls queued until the page has loaded
    var layoutObs: NSKeyValueObservation?
    var holdId: String?                 // history item this window opens held on ("Open in New Window")

    static func frameName(_ slot: Int) -> String { slot == 0 ? "ClipboardMonitorWindow" : "ClipboardMonitorWindow-\(slot)" }

    init(app: AppDelegate, slot: Int) {
        self.app = app
        self.slot = slot
        let cfg = WKWebViewConfiguration()
        web = DragWebView(frame: .zero, configuration: cfg)
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 460, height: 720),
                          styleMask: [.titled, .closable, .miniaturizable, .resizable, .fullSizeContentView],
                          backing: .buffered, defer: false)
        super.init()
        cfg.userContentController.add(WeakHandler(self), name: "app")
        web.navigationDelegate = self
        web.setValue(false, forKey: "drawsBackground")
        web.pageZoom = Settings.double("zoom")

        window.title = "Clipboard"
        window.titlebarAppearsTransparent = true
        window.titleVisibility = .hidden
        window.minSize = NSSize(width: 300, height: 200)
        window.contentView = web
        window.isReleasedWhenClosed = false
        window.tabbingIdentifier = "ClipboardMonitor"
        window.delegate = self
        let hadFrame = window.setFrameUsingName(Self.frameName(slot))
        window.setFrameAutosaveName(Self.frameName(slot))
        if !hadFrame {
            if slot == 0 { placeOnRightEdge() }
            else if let ref = app.controllers.last?.window { window.setFrameTopLeftPoint(ref.cascadeTopLeft(from: NSPoint(x: ref.frame.minX, y: ref.frame.maxY))) }
        }
        applyWindowPrefs()
        // Tab bar shown/hidden changes the usable area under the title bar.
        layoutObs = window.observe(\.contentLayoutRect, options: [.new]) { [weak self] _, _ in self?.sendInsets() }

        if let url = Bundle.main.url(forResource: "index", withExtension: "html") {
            web.loadFileURL(url, allowingReadAccessTo: url.deletingLastPathComponent())
        }
    }

    func placeOnRightEdge() {
        guard let vf = (window.screen ?? NSScreen.main ?? NSScreen.screens.first)?.visibleFrame else { return }
        let w: CGFloat = 460
        window.setFrame(NSRect(x: vf.maxX - w, y: vf.minY, width: w, height: vf.height), display: true)
    }

    func applyWindowPrefs() {
        window.level = Settings.bool("onTop") ? .floating : .normal
        var b: NSWindow.CollectionBehavior = [.fullScreenAuxiliary]
        if Settings.bool("allSpaces") { b.insert(.canJoinAllSpaces) } else { b.insert(.managed) }
        window.collectionBehavior = b
    }

    func js(_ code: String) {
        if pageReady { web.evaluateJavaScript(code, completionHandler: nil) } else { pending.append(code) }
    }

    func call(_ fn: String, _ arg: Any) {
        guard let data = try? JSONSerialization.data(withJSONObject: arg), let json = String(data: data, encoding: .utf8) else { return }
        js("window.\(fn)(\(json))")
    }

    // The traffic-light buttons sit on the left, or on the right when macOS runs in an RTL language (Hebrew).
    // Tell the page how much room to leave on each side of its header, and below the tab bar when it shows.
    func sendInsets() {
        let buttons = [NSWindow.ButtonType.closeButton, .miniaturizeButton, .zoomButton].compactMap { window.standardWindowButton($0) }
        guard let first = buttons.first, let bar = first.superview else { return }
        let frames = buttons.map { $0.frame }
        let minX = frames.map { $0.minX }.min()!, maxX = frames.map { $0.maxX }.max()!
        let width = bar.bounds.width
        let onLeft = minX < width / 2
        let covered = window.frame.height - window.contentLayoutRect.maxY  // title bar (+ tab bar)
        let z = web.pageZoom
        if covered > 34 {   // tab bar visible: the header moves below it and needs no room for the buttons
            call("monitor.setInsets", ["left": 10, "right": 10, "top": covered / z])
        } else {
            call("monitor.setInsets", ["left": (onLeft ? maxX + 14 : 10) / z, "right": (onLeft ? 10 : width - minX + 14) / z, "top": 0])
        }
    }

    // MARK: window delegate

    func windowDidResize(_ notification: Notification) { sendInsets() }
    func windowWillClose(_ notification: Notification) {
        web.configuration.userContentController.removeScriptMessageHandler(forName: "app")
        app.closed(self)
    }

    // MARK: page

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        pageReady = true
        let queued = pending; pending.removeAll()
        call("monitor.setSettings", app.settingsForPage())
        call("monitor.setState", app.stateForPage())
        sendInsets()
        queued.forEach { web.evaluateJavaScript($0, completionHandler: nil) }
        app.pageDidLoad(self)
    }

    // Links open in the default browser, never inside the monitor.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.navigationType == .linkActivated, let url = action.request.url {
            NSWorkspace.shared.open(url); decisionHandler(.cancel); return
        }
        decisionHandler(.allow)
    }

    func handle(_ message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let cmd = body["cmd"] as? String else { return }
        switch cmd {
        case "copy": if let t = body["text"] as? String { app.writeClipboard(t) }
        case "open": if let s = body["url"] as? String, let url = URL(string: s) { NSWorkspace.shared.open(url) }
        case "saveHistory": if app.controllers.first === self, let items = body["items"] { app.saveHistory(items) }
        case "dragZones":
            if let h = body["header"] as? Double { web.headerHeight = h }
            if let rects = body["controls"] as? [[Double]] {
                web.controls = rects.filter { $0.count == 4 }.map { CGRect(x: $0[0], y: $0[1], width: $0[2], height: $0[3]) }
            }
        case "title": if let t = body["title"] as? String { window.title = t }
        case "set": if let k = body["key"] as? String, let v = body["value"] { app.setSetting(k, v) }
        case "pause": app.togglePause(nil)
        case "newWindow": app.newWindow(nil)
        case "newTab": app.newWindowForTab(nil)
        case "clearAll": app.clearAllHistory()
        // Pin / unpin / delete apply to every window's history, so all windows stay the same.
        case "historyOp": app.controllers.forEach { $0.call("monitor.applyOp", body) }
        case "openItem":
            if let id = body["id"] as? String { app.makeMonitor(tabbedWith: nil, holdId: id) }
        default: break
        }
    }
}

// MARK: - App

final class AppDelegate: NSObject, NSApplicationDelegate, NSMenuItemValidation {
    var controllers: [MonitorController] = []
    var timer: Timer?
    var lastChange = NSPasteboard.general.changeCount
    var lastItem: [String: Any]?
    var paused = false
    var selfWrittenChange = -1
    var hotKeyRef: EventHotKeyRef?
    var hotKeyHandlerInstalled = false

    // Pasteboard types that password managers and similar apps use to mark secrets / throwaway data
    // (http://nspasteboard.org). We never display or keep those.
    let skipTypes: Set<String> = [
        "org.nspasteboard.ConcealedType", "org.nspasteboard.TransientType", "org.nspasteboard.AutoGeneratedType",
        "com.agilebits.onepassword", "de.petermaurer.TransientPasteboardType",
    ]

    static let historyURL: URL = {
        let dir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("Clipboard Monitor", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        return dir.appendingPathComponent("history.json")
    }()

    var current: MonitorController? {
        controllers.first { $0.window.isKeyWindow } ?? controllers.first { $0.window.isMainWindow } ?? controllers.first
    }

    func applicationDidFinishLaunching(_ note: Notification) {
        buildMenu()
        applyTheme()
        NSWindow.allowsAutomaticWindowTabbing = true
        let count = max(1, min(8, UserDefaults.standard.integer(forKey: "windowCount")))
        for _ in 0..<count { _ = makeMonitor(tabbedWith: nil) }
        registerHotKey()
        enableLoginItemOnFirstRun()
        timer = Timer.scheduledTimer(withTimeInterval: 0.35, repeats: true) { [weak self] _ in self?.poll() }
        RunLoop.main.add(timer!, forMode: .common)
        NSApp.activate(ignoringOtherApps: true)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ app: NSApplication) -> Bool { false }
    func applicationShouldHandleReopen(_ app: NSApplication, hasVisibleWindows: Bool) -> Bool {
        if controllers.isEmpty { _ = makeMonitor(tabbedWith: nil) } else { controllers.forEach { $0.window.makeKeyAndOrderFront(nil) } }
        return true
    }
    func applicationWillTerminate(_ notification: Notification) { saveWindowCount() }

    // MARK: windows & tabs

    @discardableResult
    func makeMonitor(tabbedWith host: NSWindow?, holdId: String? = nil) -> MonitorController {
        let used = Set(controllers.map { $0.slot })
        let slot = (0...).first { !used.contains($0) }!
        let c = MonitorController(app: self, slot: slot)
        c.holdId = holdId
        controllers.append(c)
        if let host = host { host.addTabbedWindow(c.window, ordered: .above) }
        c.window.makeKeyAndOrderFront(nil)
        saveWindowCount()
        return c
    }

    @objc func newWindow(_ sender: Any?) { makeMonitor(tabbedWith: nil); NSApp.activate(ignoringOtherApps: true) }
    // Called by ⌘T and by the "+" button of the window tab bar.
    @objc func newWindowForTab(_ sender: Any?) {
        guard let host = current?.window else { newWindow(nil); return }
        makeMonitor(tabbedWith: host)
    }

    func closed(_ c: MonitorController) {
        controllers.removeAll { $0 === c }
        if !NSApp.isRunning || controllers.isEmpty { return }
        saveWindowCount()
    }

    func saveWindowCount() {
        guard !controllers.isEmpty else { return } // closing the last window still reopens one at launch
        UserDefaults.standard.set(controllers.count, forKey: "windowCount")
    }

    /// A new page starts with the same history as the window that already exists.
    func pageDidLoad(_ c: MonitorController) {
        let hold = { if let id = c.holdId { c.call("monitor.showHeld", ["id": id]); c.holdId = nil } }
        if let source = controllers.first(where: { $0 !== c && $0.pageReady }) {
            source.web.evaluateJavaScript("JSON.stringify(window.monitor.exportHistory())") { result, _ in
                if let s = result as? String { c.js("window.monitor.loadHistory(\(s))") }
                hold()
            }
        } else if Settings.bool("keepHistory"), let data = try? Data(contentsOf: Self.historyURL),
                  let items = try? JSONSerialization.jsonObject(with: data) {
            c.call("monitor.loadHistory", items)
            hold()
        } else {
            hold()
        }
        if let item = lastItem { c.call("monitor.push", item) } else { lastChange = -1; poll() }
    }

    // MARK: clipboard

    func poll() {
        let pb = NSPasteboard.general
        let cc = pb.changeCount
        guard cc != lastChange else { return }
        lastChange = cc
        if paused { return }
        let types = pb.types?.map { $0.rawValue } ?? []
        let front = NSWorkspace.shared.frontmostApplication
        if isIgnored(front) { return }
        var item: [String: Any] = ["id": UUID().uuidString, "time": Date().timeIntervalSince1970 * 1000, "self": cc == selfWrittenChange]
        if let app = front?.localizedName { item["app"] = app }
        if types.contains(where: { skipTypes.contains($0) }) {
            item["kind"] = "secret"
        } else if let s = pb.string(forType: .string), !s.isEmpty {
            item["kind"] = "text"; item["text"] = s
            if let html = pb.string(forType: .html), html.utf8.count < 2_000_000 { item["html"] = html }
        } else if let url = pb.string(forType: .fileURL) {
            item["kind"] = "text"; item["text"] = URL(string: url)?.path ?? url
        } else if let img = NSImage(pasteboard: pb), let png = pngData(img, maxSide: 1600) {
            item["kind"] = "image"; item["image"] = "data:image/png;base64," + png.base64EncodedString()
            item["size"] = "\(Int(img.size.width))×\(Int(img.size.height))"
        } else {
            item["kind"] = "other"; item["types"] = types.prefix(6).joined(separator: ", ")
        }
        lastItem = item
        controllers.forEach { $0.call("monitor.push", item) }
    }

    func isIgnored(_ app: NSRunningApplication?) -> Bool {
        guard let app = app else { return false }
        let names = Settings.string("ignoredApps").split(whereSeparator: { $0 == "," || $0 == "\n" })
            .map { $0.trimmingCharacters(in: .whitespaces).lowercased() }.filter { !$0.isEmpty }
        let mine = [app.localizedName?.lowercased(), app.bundleIdentifier?.lowercased()].compactMap { $0 }
        return names.contains { mine.contains($0) }
    }

    func pngData(_ img: NSImage, maxSide: CGFloat) -> Data? {
        var size = img.size
        guard size.width > 0, size.height > 0 else { return nil }
        let scale = min(1, maxSide / max(size.width, size.height))
        size = NSSize(width: size.width * scale, height: size.height * scale)
        guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: Int(size.width), pixelsHigh: Int(size.height),
                                         bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                         colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0) else { return nil }
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        img.draw(in: NSRect(origin: .zero, size: size))
        NSGraphicsContext.restoreGraphicsState()
        return rep.representation(using: .png, properties: [:])
    }

    func writeClipboard(_ text: String) {
        let pb = NSPasteboard.general
        pb.clearContents(); pb.setString(text, forType: .string)
        selfWrittenChange = pb.changeCount
    }

    func saveHistory(_ items: Any) {
        guard Settings.bool("keepHistory"), let data = try? JSONSerialization.data(withJSONObject: items) else { return }
        try? data.write(to: Self.historyURL, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: Self.historyURL.path)
    }

    func clearAllHistory() {
        try? FileManager.default.removeItem(at: Self.historyURL)
        controllers.forEach { $0.js("window.monitor.clearHistory()") }
    }

    // MARK: settings

    var loginItemEnabled: Bool {
        if #available(macOS 13.0, *) { return SMAppService.mainApp.status == .enabled }
        return false
    }

    func settingsForPage() -> [String: Any] {
        var s = Settings.all
        s["loginItem"] = loginItemEnabled
        if #available(macOS 13.0, *) { s["loginSupported"] = true } else { s["loginSupported"] = false }
        return s
    }

    func stateForPage() -> [String: Any] { ["paused": paused] }

    func broadcastSettings() {
        let s = settingsForPage()
        controllers.forEach { $0.call("monitor.setSettings", s) }
    }

    func setSetting(_ key: String, _ value: Any) {
        switch key {
        case "loginItem": setLoginItem((value as? NSNumber)?.boolValue ?? false)
        default:
            guard Settings.defaults[key] != nil else { return }
            Settings.set(key, value)
        }
        switch key {
        case "onTop", "allSpaces": controllers.forEach { $0.applyWindowPrefs() }
        case "theme": applyTheme()
        case "zoom": controllers.forEach { $0.web.pageZoom = Settings.double("zoom"); $0.sendInsets() }
        case "hotkey": registerHotKey()
        case "keepHistory":
            if Settings.bool("keepHistory") { controllers.first?.js("window.monitor.saveNow()") }
            else { try? FileManager.default.removeItem(at: Self.historyURL) }
        default: break
        }
        broadcastSettings()
    }

    func applyTheme() {
        switch Settings.string("theme") {
        case "light": NSApp.appearance = NSAppearance(named: .aqua)
        case "dark": NSApp.appearance = NSAppearance(named: .darkAqua)
        default: NSApp.appearance = nil
        }
    }

    // MARK: global hot key: show the monitor, or hide it when it is already in front

    func registerHotKey() {
        if !hotKeyHandlerInstalled {
            var spec = EventTypeSpec(eventClass: OSType(kEventClassKeyboard), eventKind: UInt32(kEventHotKeyPressed))
            InstallEventHandler(GetApplicationEventTarget(), { _, _, _ in
                DispatchQueue.main.async { (NSApp.delegate as? AppDelegate)?.toggleVisible() }
                return noErr
            }, 1, &spec, nil, nil)
            hotKeyHandlerInstalled = true
        }
        if let ref = hotKeyRef { UnregisterEventHotKey(ref); hotKeyRef = nil }
        guard let preset = hotKeyPresets[Settings.string("hotkey")] else { return } // "off"
        let id = EventHotKeyID(signature: OSType(0x434C4D4E), id: 1) // 'CLMN'
        RegisterEventHotKey(UInt32(preset.key), UInt32(preset.mods), id, GetApplicationEventTarget(), 0, &hotKeyRef)
    }

    func toggleVisible() {
        if NSApp.isActive, let w = NSApp.keyWindow, w.isVisible {
            NSApp.hide(nil)
        } else {
            NSApp.unhide(nil)
            if controllers.isEmpty { _ = makeMonitor(tabbedWith: nil) }
            controllers.forEach { $0.window.orderFront(nil) }
            current?.window.makeKeyAndOrderFront(nil)
            NSApp.activate(ignoringOtherApps: true)
        }
    }

    // MARK: launch at login (macOS 13+)

    func enableLoginItemOnFirstRun() {
        guard !UserDefaults.standard.bool(forKey: "loginItemInitialized") else { return }
        UserDefaults.standard.set(true, forKey: "loginItemInitialized")
        if #available(macOS 13.0, *) { try? SMAppService.mainApp.register() }
    }

    func setLoginItem(_ on: Bool) {
        guard #available(macOS 13.0, *) else { return }
        do {
            if on { try SMAppService.mainApp.register() } else { try SMAppService.mainApp.unregister() }
        } catch {
            let a = NSAlert(); a.messageText = "Could not change Launch at Login"; a.informativeText = error.localizedDescription; a.runModal()
        }
        if SMAppService.mainApp.status == .requiresApproval { SMAppService.openSystemSettingsLoginItems() }
    }

    // MARK: menu actions

    func toggle(_ key: String) { setSetting(key, !Settings.bool(key)) }
    @objc func toggleOnTop(_ sender: Any?) { toggle("onTop") }
    @objc func toggleAllSpaces(_ sender: Any?) { toggle("allSpaces") }
    @objc func toggleLoginItem(_ sender: Any?) { setSetting("loginItem", !loginItemEnabled) }
    @objc func togglePause(_ sender: Any?) {
        paused.toggle()
        if !paused { lastChange = NSPasteboard.general.changeCount }
        controllers.forEach { $0.call("monitor.setState", stateForPage()) }
    }
    @objc func setThemeSystem(_ sender: Any?) { setSetting("theme", "system") }
    @objc func setThemeLight(_ sender: Any?) { setSetting("theme", "light") }
    @objc func setThemeDark(_ sender: Any?) { setSetting("theme", "dark") }
    @objc func zoomIn(_ sender: Any?) { setSetting("zoom", min(3.0, Settings.double("zoom") + 0.1)) }
    @objc func zoomOut(_ sender: Any?) { setSetting("zoom", max(0.5, Settings.double("zoom") - 0.1)) }
    @objc func zoomReset(_ sender: Any?) { setSetting("zoom", 1.0) }
    @objc func openSettings(_ sender: Any?) {
        if controllers.isEmpty { _ = makeMonitor(tabbedWith: nil) }
        current?.window.makeKeyAndOrderFront(nil)
        current?.js("window.monitor.openSettings()")
    }
    @objc func toggleRaw(_ sender: Any?) { current?.js("window.monitor.toggleRaw()") }
    @objc func toggleHold(_ sender: Any?) { current?.js("window.monitor.toggleHold()") }
    @objc func toggleHistory(_ sender: Any?) { current?.js("window.monitor.toggleHistory()") }
    @objc func clearHistory(_ sender: Any?) { clearAllHistory() }
    @objc func copyRtl(_ sender: Any?) { current?.js("window.monitor.copyRtl()") }
    @objc func snapRight(_ sender: Any?) { current?.placeOnRightEdge() }
    @objc func showAll(_ sender: Any?) { toggleVisible() }

    func validateMenuItem(_ item: NSMenuItem) -> Bool {
        switch item.action {
        case #selector(toggleOnTop(_:)): item.state = Settings.bool("onTop") ? .on : .off
        case #selector(toggleAllSpaces(_:)): item.state = Settings.bool("allSpaces") ? .on : .off
        case #selector(togglePause(_:)): item.state = paused ? .on : .off
        case #selector(setThemeSystem(_:)): item.state = Settings.string("theme") == "system" ? .on : .off
        case #selector(setThemeLight(_:)): item.state = Settings.string("theme") == "light" ? .on : .off
        case #selector(setThemeDark(_:)): item.state = Settings.string("theme") == "dark" ? .on : .off
        case #selector(toggleLoginItem(_:)):
            item.state = loginItemEnabled ? .on : .off
            if #available(macOS 13.0, *) { return true } else { return false }
        case #selector(toggleRaw(_:)), #selector(toggleHold(_:)), #selector(toggleHistory(_:)), #selector(copyRtl(_:)), #selector(snapRight(_:)):
            return current != nil
        default: break
        }
        return true
    }

    func buildMenu() {
        let main = NSMenu()
        func add(_ menu: NSMenu, _ title: String, _ action: Selector?, _ key: String, _ mods: NSEvent.ModifierFlags = [.command], target: AnyObject? = nil) {
            let it = NSMenuItem(title: title, action: action, keyEquivalent: key)
            it.keyEquivalentModifierMask = mods
            it.target = target
            menu.addItem(it)
        }
        let appItem = NSMenuItem(); main.addItem(appItem)
        let app = NSMenu()
        add(app, "About Clipboard Monitor", #selector(NSApplication.orderFrontStandardAboutPanel(_:)), "")
        app.addItem(.separator())
        add(app, "Settings…", #selector(openSettings(_:)), ",", target: self)
        add(app, "Launch at Login", #selector(toggleLoginItem(_:)), "", target: self)
        app.addItem(.separator())
        add(app, "Hide", #selector(NSApplication.hide(_:)), "h")
        add(app, "Quit Clipboard Monitor", #selector(NSApplication.terminate(_:)), "q")
        appItem.submenu = app

        let fileItem = NSMenuItem(); main.addItem(fileItem)
        let file = NSMenu(title: "File")
        add(file, "New Window", #selector(newWindow(_:)), "n", target: self)
        add(file, "New Tab", #selector(newWindowForTab(_:)), "t", target: self)
        file.addItem(.separator())
        add(file, "Close", #selector(NSWindow.performClose(_:)), "w")
        fileItem.submenu = file

        let editItem = NSMenuItem(); main.addItem(editItem)
        let edit = NSMenu(title: "Edit")
        add(edit, "Copy", #selector(NSText.copy(_:)), "c")
        add(edit, "Select All", #selector(NSText.selectAll(_:)), "a")
        add(edit, "Copy with RTL Marks", #selector(copyRtl(_:)), "c", [.command, .shift], target: self)
        editItem.submenu = edit

        let viewItem = NSMenuItem(); main.addItem(viewItem)
        let view = NSMenu(title: "View")
        let themeItem = NSMenuItem(title: "Appearance", action: nil, keyEquivalent: "")
        let theme = NSMenu(title: "Appearance")
        add(theme, "System", #selector(setThemeSystem(_:)), "", target: self)
        add(theme, "Light", #selector(setThemeLight(_:)), "", target: self)
        add(theme, "Dark", #selector(setThemeDark(_:)), "", target: self)
        themeItem.submenu = theme
        view.addItem(themeItem)
        view.addItem(.separator())
        add(view, "Always on Top", #selector(toggleOnTop(_:)), "t", [.command, .shift], target: self)
        add(view, "Show on All Desktops", #selector(toggleAllSpaces(_:)), "", target: self)
        add(view, "Pause Monitoring", #selector(togglePause(_:)), "p", [.command, .shift], target: self)
        view.addItem(.separator())
        add(view, "Hold This Item (stop following)", #selector(toggleHold(_:)), "l", target: self)
        add(view, "Raw / Rendered", #selector(toggleRaw(_:)), "r", target: self)
        add(view, "History", #selector(toggleHistory(_:)), "y", target: self)
        add(view, "Clear History", #selector(clearHistory(_:)), "k", target: self)
        view.addItem(.separator())
        add(view, "Zoom In", #selector(zoomIn(_:)), "+", target: self)
        add(view, "Zoom In", #selector(zoomIn(_:)), "=", target: self)
        add(view, "Zoom Out", #selector(zoomOut(_:)), "-", target: self)
        add(view, "Actual Size", #selector(zoomReset(_:)), "0", target: self)
        view.addItem(.separator())
        add(view, "Snap to Right Edge", #selector(snapRight(_:)), "", target: self)
        viewItem.submenu = view

        let winItem = NSMenuItem(); main.addItem(winItem)
        let win = NSMenu(title: "Window")
        add(win, "Show / Hide Monitors", #selector(showAll(_:)), "1", target: self)
        add(win, "Minimize", #selector(NSWindow.miniaturize(_:)), "m")
        win.addItem(.separator())
        winItem.submenu = win
        NSApp.windowsMenu = win

        NSApp.mainMenu = main
    }
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
