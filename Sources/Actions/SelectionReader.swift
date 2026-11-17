import Cocoa
import Carbon
import ApplicationServices

// MARK: - Selected text of another app (Text Actions)
//
// Reads the selection of the focused element from the accessibility tree, keeping its line breaks, and remembers
// the element so the result of an action can be written back in its place (SelectionWriter). Apps that do not
// expose their selection get a ⌘C fallback: the keystroke is posted, the pasteboard is read and then restored.
//
// Thread: `read` and `copyFallback` run on a background serial queue (AX calls and the wait for the copy block);
// PasteboardSnapshot is taken and restored on the main thread.

/// Text the user selected in another app.
struct TextSelection: @unchecked Sendable {     // AXUIElement is an immutable CF reference
    /// Cleaned text shown to the user and sent to the action.
    let text: String
    /// The selected text exactly as the app reported it; used to check that the selection did not change.
    let raw: String
    /// Global, top-left based. Zero size at the pointer when the app gives no bounds.
    let anchor: CGRect
    let pid: pid_t
    /// The focused element, when the text came from the accessibility tree.
    let element: AXUIElement?
}

enum SelectionRead: Sendable {
    case found(TextSelection)
    case secure         // a password field: never read
    case none
}

enum SelectionReader {
    static let maxText = 20_000
    static let timeout: Float = 0.5

    /// The selection of the focused element of the front app. `pointer` is the fallback anchor.
    static func read(frontPid: pid_t?, pointer: CGPoint, excluding myPid: pid_t) -> SelectionRead {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, timeout)
        var focused = AXTextReader.copy(system, kAXFocusedUIElementAttribute).flatMap(element)
        if focused == nil, let frontPid, frontPid != myPid {
            let app = AXUIElementCreateApplication(frontPid)
            AXUIElementSetMessagingTimeout(app, timeout)
            focused = AXTextReader.copy(app, kAXFocusedUIElementAttribute).flatMap(element)
        }
        guard let focused else { return .none }
        var pid: pid_t = 0
        AXUIElementGetPid(focused, &pid)
        guard pid != myPid else { return .none }
        AXUIElementSetMessagingTimeout(focused, timeout)
        if AXTextReader.role(of: focused) == "AXSecureTextField"
            || (AXTextReader.copy(focused, kAXSubroleAttribute) as? String) == "AXSecureTextField" { return .secure }
        guard let raw = AXTextReader.copy(focused, kAXSelectedTextAttribute) as? String else { return .none }
        let text = clean(raw)
        guard !text.isEmpty else { return .none }
        let anchor = bounds(of: focused) ?? CGRect(origin: pointer, size: .zero)
        return .found(TextSelection(text: text, raw: raw, anchor: anchor, pid: pid, element: focused))
    }

    /// Screen rectangle of the selection: text views answer by character range, web content by text marker range.
    private static func bounds(of el: AXUIElement) -> CGRect? {
        if let v = AXTextReader.copy(el, kAXSelectedTextRangeAttribute), var r = AXTextReader.cfRange(v), r.location >= 0, r.length > 0,
           let arg = AXValueCreate(.cfRange, &r),
           let b = AXTextReader.cgRect(AXTextReader.param(el, kAXBoundsForRangeParameterizedAttribute, arg)), usable(b) {
            return b
        }
        if let markers = AXTextReader.copy(el, "AXSelectedTextMarkerRange"),
           let b = AXTextReader.cgRect(AXTextReader.param(el, "AXBoundsForTextMarkerRange", markers)), usable(b) {
            return b
        }
        return nil
    }

    private static func usable(_ b: CGRect) -> Bool { b.width > 0 && b.height > 0 && b.height < 2000 }

    private static func element(_ v: CFTypeRef) -> AXUIElement? {
        CFGetTypeID(v) == AXUIElementGetTypeID() ? (v as! AXUIElement) : nil
    }

    static func clean(_ s: String) -> String {
        let t = s.replacingOccurrences(of: "\u{FFFC}", with: "")        // inline images, attachments
            .replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return String(t.prefix(maxText))
    }

    // MARK: ⌘C fallback

    /// Posts ⌘C to the front app and returns what it put on the pasteboard, or nil when nothing was copied.
    /// The caller snapshots the pasteboard before and restores it after, and keeps the clipboard monitor quiet.
    static func copyFallback() -> String? {
        let pb = NSPasteboard.general
        let before = pb.changeCount
        Keystroke.waitForModifiersUp()
        Keystroke.post(CGKeyCode(kVK_ANSI_C), flags: .maskCommand)
        let deadline = Date().addingTimeInterval(0.6)
        while pb.changeCount == before, Date() < deadline { Thread.sleep(forTimeInterval: 0.02) }
        guard pb.changeCount != before, let s = pb.string(forType: .string) else { return nil }
        let text = clean(s)
        return text.isEmpty ? nil : text
    }
}

// MARK: - Keystrokes sent to the front app (needs the Accessibility permission)

enum Keystroke {
    static func post(_ key: CGKeyCode, flags: CGEventFlags) {
        let src = CGEventSource(stateID: .combinedSessionState)
        let down = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: true)
        let up = CGEvent(keyboardEventSource: src, virtualKey: key, keyDown: false)
        down?.flags = flags
        up?.flags = flags
        down?.post(tap: .cghidEventTap)
        up?.post(tap: .cghidEventTap)
    }

    /// The shortcut that opened the popover may still be held down; its modifiers would change the keystroke.
    static func waitForModifiersUp(limit: TimeInterval = 0.5) {
        let mask: CGEventFlags = [.maskControl, .maskAlternate, .maskShift, .maskCommand]
        let deadline = Date().addingTimeInterval(limit)
        while !CGEventSource.flagsState(.combinedSessionState).intersection(mask).isEmpty, Date() < deadline {
            Thread.sleep(forTimeInterval: 0.02)
        }
    }
}

// MARK: - Pasteboard contents kept across a temporary copy or paste

struct PasteboardSnapshot {
    private let items: [[NSPasteboard.PasteboardType: Data]]

    static func take() -> PasteboardSnapshot {
        let items = (NSPasteboard.general.pasteboardItems ?? []).map { item -> [NSPasteboard.PasteboardType: Data] in
            var d: [NSPasteboard.PasteboardType: Data] = [:]
            for t in item.types { if let data = item.data(forType: t) { d[t] = data } }
            return d
        }
        return PasteboardSnapshot(items: items)
    }

    func restore() {
        let pb = NSPasteboard.general
        pb.clearContents()
        let restored = items.filter { !$0.isEmpty }.map { d -> NSPasteboardItem in
            let item = NSPasteboardItem()
            for (t, data) in d { item.setData(data, forType: t) }
            return item
        }
        if !restored.isEmpty { pb.writeObjects(restored) }
    }
}
