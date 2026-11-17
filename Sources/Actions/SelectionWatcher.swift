import Cocoa
import ApplicationServices

// MARK: - Floating button next to a fresh selection (Text Actions)
//
// After a drag or a double-click in another app, the selection of the focused element is read from the
// accessibility tree. When there is one, a small button appears next to the pointer; a click opens the Text
// Actions popover on that selection. The button goes away on the next click, key press or scroll, or after a few
// seconds. No keystrokes are sent from here: apps that do not expose their selection simply get no button (the
// shortcut still works there). Needs the Accessibility permission; without it nothing happens and nothing is asked.

private final class FirstClickButton: NSButton {
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }
}

@MainActor
final class SelectionWatcher: NSObject {
    static let shared = SelectionWatcher()

    private var monitors: [Any] = []
    private var downAt: NSPoint = .zero
    private var panel: NSPanel?
    private var found: TextSelection?
    private var hideTimer: Timer?
    private var generation = 0
    private let queue = DispatchQueue(label: "clipboard-monitor.watcher.ax", qos: .userInitiated)

    static let size: CGFloat = 28
    static let lifetime: TimeInterval = 6

    /// Starts or stops watching to match the settings.
    func refresh() {
        let on = Settings.bool("f.actions") && Settings.bool("actionsButton")
        if on, monitors.isEmpty {
            let add = { (mask: NSEvent.EventTypeMask, handler: @escaping @MainActor (NSEvent) -> Void) in
                if let m = NSEvent.addGlobalMonitorForEvents(matching: mask, handler: { e in
                    MainActor.assumeIsolated { handler(e) }      // global monitors run on the main thread
                }) { self.monitors.append(m) }
            }
            add([.leftMouseDown]) { _ in SelectionWatcher.shared.mouseDown() }
            add([.leftMouseUp]) { e in SelectionWatcher.shared.mouseUp(clicks: e.clickCount) }
            add([.keyDown, .scrollWheel, .rightMouseDown]) { _ in SelectionWatcher.shared.hideButton() }
        } else if !on, !monitors.isEmpty {
            monitors.forEach { NSEvent.removeMonitor($0) }
            monitors.removeAll()
            hideButton()
        }
    }

    private func mouseDown() {
        hideButton()
        downAt = NSEvent.mouseLocation
    }

    private func mouseUp(clicks: Int) {
        let up = NSEvent.mouseLocation
        // A plain click selects nothing: only a drag or a double / triple click is worth a look.
        guard hypot(up.x - downAt.x, up.y - downAt.y) > 4 || clicks >= 2 else { return }
        generation += 1
        let gen = generation
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { SelectionWatcher.shared.look(at: up, gen: gen) }
    }

    private func look(at up: NSPoint, gen: Int) {
        guard gen == generation, AXTextReader.trusted, !ActionsController.isOpen, !BubbleController.isOpen,
              let d = NSApp.delegate as? AppDelegate,
              let front = NSWorkspace.shared.frontmostApplication, front.processIdentifier != getpid(),
              !d.isIgnored(front) else { return }
        let primaryHeight = NSScreen.screens.first?.frame.height ?? 0
        let pointer = CGPoint(x: up.x, y: primaryHeight - up.y)
        let pid = front.processIdentifier
        queue.async {
            let r = SelectionReader.read(frontPid: pid, pointer: pointer, excluding: getpid())
            DispatchQueue.main.async { SelectionWatcher.shared.didRead(r, at: up, gen: gen) }
        }
    }

    private func didRead(_ r: SelectionRead, at up: NSPoint, gen: Int) {
        guard gen == generation, case .found(let sel) = r, sel.text.count >= 2,
              sel.text.contains(where: { $0.isLetter || $0.isNumber }), !ActionsController.isOpen else { return }
        found = sel
        show(at: up)
    }

    private func show(at up: NSPoint) {
        let p = panel ?? makePanel()
        panel = p
        let s = Self.size
        var origin = NSPoint(x: up.x + 10, y: up.y - s - 10)        // just below and after the pointer
        let screen = NSScreen.screens.first { $0.frame.contains(up) } ?? NSScreen.main
        if let vf = screen?.visibleFrame {
            origin.x = max(vf.minX + 4, min(origin.x, vf.maxX - s - 4))
            origin.y = max(vf.minY + 4, min(origin.y, vf.maxY - s - 4))
        }
        p.setFrame(NSRect(x: origin.x, y: origin.y, width: s, height: s), display: true)
        p.orderFrontRegardless()
        hideTimer?.invalidate()
        hideTimer = Timer.scheduledTimer(withTimeInterval: Self.lifetime, repeats: false) { _ in
            MainActor.assumeIsolated { SelectionWatcher.shared.hideButton() }
        }
    }

    func hideButton() {
        generation += 1
        hideTimer?.invalidate(); hideTimer = nil
        found = nil
        panel?.orderOut(nil)
    }

    @objc private func clicked(_ sender: Any?) {
        guard let sel = found else { hideButton(); return }
        hideButton()
        ActionsController.open(sel)
    }

    private func makePanel() -> NSPanel {
        let s = Self.size
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: s, height: s), styleMask: [.borderless, .nonactivatingPanel],
                        backing: .buffered, defer: false)
        p.isOpaque = false
        p.backgroundColor = .clear
        p.hasShadow = true
        p.level = .popUpMenu
        p.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient]
        p.isFloatingPanel = true
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false
        p.sharingType = .none
        let bg = NSVisualEffectView(frame: NSRect(x: 0, y: 0, width: s, height: s))
        bg.material = .popover
        bg.state = .active
        bg.wantsLayer = true
        bg.layer?.cornerRadius = 7
        bg.layer?.masksToBounds = true
        let b = FirstClickButton(frame: bg.bounds)
        b.isBordered = false
        b.image = NSImage(systemSymbolName: "wand.and.stars", accessibilityDescription: L("menu.view.actions"))
        b.imagePosition = .imageOnly
        b.contentTintColor = .controlAccentColor
        b.toolTip = L("menu.view.actions")
        b.target = self
        b.action = #selector(clicked(_:))
        bg.addSubview(b)
        p.contentView = bg
        return p
    }
}
