import Cocoa
import ApplicationServices

// MARK: - Accessibility text reader (Translation Lens)
//
// Reads the text that another app shows inside a screen region, with the bounds of every line, from that app's
// accessibility tree (AXUIElement). No screenshots: the text is exact (Hebrew and RTL included) and only the
// Accessibility permission is needed.
//
// Coordinates: everything here is global and top-left based (origin at the top-left of the primary screen), the
// same space the window server (CGWindowList) and the accessibility API use.
//
// Thread: call from one background serial queue. AX calls are IPC to the other app and can block (each one is
// capped by the messaging timeout).

/// One piece of text on screen: a line, or a whole block when the app cannot split it into lines.
struct LensSpan: Hashable, Sendable {
    let text: String
    let rect: CGRect
    /// True when `rect` is a single line (its height is the line height).
    let singleLine: Bool
    /// The source text has a line break right after this line (end of a paragraph in an editor).
    var breakAfter = false
}

/// The window under the lens.
struct LensTarget: Equatable, Sendable {
    let pid: pid_t
    let windowNumber: Int
    let bounds: CGRect
}

enum AXTextReader {
    // Budgets that keep one read fast on huge trees (long web pages, big tables).
    static let maxNodes = 4000
    static let maxDepth = 80
    static let maxSpans = 500
    static let maxLinesPerElement = 300
    static let messagingTimeout: Float = 0.25

    // MARK: permission

    static var trusted: Bool { AXIsProcessTrusted() }

    /// Shows the system prompt that sends the user to Privacy & Security › Accessibility (once per launch at most).
    static func requestTrust() {
        let key = kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String
        _ = AXIsProcessTrustedWithOptions([key: true] as CFDictionary)
    }

    static func openAccessibilitySettings() {
        if let url = URL(string: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility") {
            NSWorkspace.shared.open(url)
        }
    }

    // MARK: window under the lens

    /// Front-most normal window of another app under `region`: the first (front to back) that contains the
    /// region's center, else the first that overlaps it.
    static func windowUnder(_ region: CGRect, excluding myPid: pid_t) -> LensTarget? {
        guard let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID)
                as? [[String: Any]] else { return nil }
        let center = CGPoint(x: region.midX, y: region.midY)
        var overlapping: LensTarget?
        for w in list {
            guard let pid = (w[kCGWindowOwnerPID as String] as? NSNumber)?.int32Value, pid != myPid,
                  (w[kCGWindowLayer as String] as? NSNumber)?.intValue == 0,
                  ((w[kCGWindowAlpha as String] as? NSNumber)?.doubleValue ?? 1) > 0.05,
                  let number = (w[kCGWindowNumber as String] as? NSNumber)?.intValue,
                  let dict = w[kCGWindowBounds as String] as? NSDictionary,
                  let bounds = CGRect(dictionaryRepresentation: dict as CFDictionary),
                  bounds.width > 40, bounds.height > 40 else { continue }
            let t = LensTarget(pid: pid, windowNumber: number, bounds: bounds)
            if bounds.contains(center) { return t }
            if overlapping == nil, bounds.intersects(region) { overlapping = t }
        }
        return overlapping
    }

    // MARK: Chromium / Electron

    private static var manualEnabled = Set<pid_t>()
    private static let manualLock = NSLock()

    /// Chrome, Edge, Slack, VS Code, Teams and other Chromium / Electron apps build their accessibility tree only
    /// when asked. Returns true the first time it is switched on for `pid`: the tree then appears a moment later.
    /// Called from the lens and the bubble queues.
    static func enableManualAccessibility(_ pid: pid_t) -> Bool {
        manualLock.lock()
        let first = manualEnabled.insert(pid).inserted
        manualLock.unlock()
        guard first else { return false }
        let app = AXUIElementCreateApplication(pid)
        return AXUIElementSetAttributeValue(app, "AXManualAccessibility" as CFString, kCFBooleanTrue) == .success
    }

    // MARK: read

    /// Text lines of `target` that lie inside `region`, merged into reading order per line.
    static func read(_ target: LensTarget, region: CGRect) -> [LensSpan] {
        let app = AXUIElementCreateApplication(target.pid)
        AXUIElementSetMessagingTimeout(app, messagingTimeout)
        guard let window = matchWindow(app, target.bounds) else { return [] }
        var budget = maxNodes
        var spans: [LensSpan] = []
        walk(window, region: region, depth: 0, budget: &budget, out: &spans)
        return merge(clip(spans, to: region))
    }

    /// The AX window whose frame matches the window-server bounds best.
    private static func matchWindow(_ app: AXUIElement, _ bounds: CGRect) -> AXUIElement? {
        let windows = (copy(app, kAXWindowsAttribute) as? [AXUIElement]) ?? []
        var best: (AXUIElement, CGFloat)?
        for w in windows {
            guard let f = frame(of: w) else { continue }
            let d = abs(f.minX - bounds.minX) + abs(f.minY - bounds.minY) + abs(f.width - bounds.width) + abs(f.height - bounds.height)
            if best == nil || d < best!.1 { best = (w, d) }
        }
        if let best { return best.0 }
        return copy(app, kAXFocusedWindowAttribute).map { $0 as! AXUIElement }
    }

    private static let textRoles: Set<String> = ["AXStaticText", "AXTextArea", "AXTextField", "AXComboBox"]
    private static let titleRoles: Set<String> = ["AXButton", "AXRadioButton", "AXCheckBox", "AXPopUpButton",
                                                  "AXMenuButton", "AXMenuItem", "AXMenuBarItem", "AXTab"]
    private static let rowContainers: Set<String> = ["AXTable", "AXOutline"]
    private static let visibleChildContainers: Set<String> = ["AXList", "AXBrowser", "AXGrid"]
    private static let skippedRoles: Set<String> = ["AXImage", "AXScrollBar", "AXValueIndicator", "AXSecureTextField"]

    private static func walk(_ e: AXUIElement, attrs: Attrs? = nil, region: CGRect, depth: Int, budget: inout Int, out: inout [LensSpan]) {
        guard depth < maxDepth, budget > 0, out.count < maxSpans else { return }
        let a: Attrs
        if let attrs { a = attrs } else { budget -= 1; a = Attrs(e) }
        if let f = a.frame, f.width > 0, f.height > 0, !f.intersects(region) { return }
        if skippedRoles.contains(a.role) || a.subrole == "AXSecureTextField" { return }

        if textRoles.contains(a.role) {
            let text = a.value ?? a.title ?? ""
            if text.contains(where: { $0.isLetter }) {
                if let lines = lines(of: e, value: text, region: region) { out += lines }
                else if let f = a.frame { out.append(LensSpan(text: tidy(text), rect: f, singleLine: false)) }
                return  // its children (if any) repeat the same text
            }
            // An empty text element can still hold its text in children (some web editors): look inside.
            if a.children.isEmpty { return }
        }
        if titleRoles.contains(a.role) {
            if let t = a.title, t.contains(where: { $0.isLetter }), let f = a.frame {
                out.append(LensSpan(text: tidy(t), rect: f, singleLine: true))
                return
            }
        }

        var children = a.children
        if rowContainers.contains(a.role), let rows = copy(e, kAXVisibleRowsAttribute) as? [AXUIElement] {
            // Table and outline rows: only the visible ones, plus the header and other non-row children.
            children = rows + children.filter { role(of: $0) != "AXRow" }
        } else if visibleChildContainers.contains(a.role), let visible = copy(e, kAXVisibleChildrenAttribute) as? [AXUIElement] {
            children = visible
        }
        // Fetch the children once: they decide whether this element is a paragraph, and the walk reuses them.
        var fetched: [(AXUIElement, Attrs)] = []
        for c in children {
            guard budget > 0 else { break }
            budget -= 1
            fetched.append((c, Attrs(c)))
        }
        if let p = paragraph(fetched, budget: &budget) {
            out.append(p)
            return
        }
        for (c, ca) in fetched {
            guard budget > 0, out.count < maxSpans else { break }
            walk(c, attrs: ca, region: region, depth: depth + 1, budget: &budget, out: &out)
        }
    }

    // MARK: paragraphs

    /// Web pages and Electron apps split one paragraph into text runs at every link, inline code or bold word, and
    /// a run that wraps reports one rectangle as wide as the paragraph. Translating the runs one by one breaks the
    /// sentences and the boxes cover each other. An element whose children are all inline (text runs, links, inline
    /// code, list markers), with at least one text run directly inside it, is read as one paragraph instead: its
    /// text in document order (the reading order, right to left included) and the union of the runs' frames.
    private static func paragraph(_ children: [(AXUIElement, Attrs)], budget: inout Int) -> LensSpan? {
        guard children.count >= 2, children.count <= 200,
              children.contains(where: { $0.1.role == "AXStaticText" }) else { return nil }
        var text = ""
        var rects: [CGRect] = []
        var lineHeight = CGFloat.greatestFiniteMagnitude
        for (c, a) in children {
            guard let item = inline(c, a, depth: 0, budget: &budget) else { return nil }
            text += item.0
            rects += item.1
            lineHeight = min(lineHeight, item.2)
        }
        let clean = tidy(text)
        guard clean.contains(where: { $0.isLetter }), let first = rects.first else { return nil }
        let rect = rects.dropFirst().reduce(first) { $0.union($1) }
        let singleLine = lineHeight < .greatestFiniteMagnitude && rect.height < lineHeight * 1.6
        return LensSpan(text: clean, rect: rect, singleLine: singleLine)
    }

    /// Text, frames and the smallest line height of an inline element, or nil when it is not inline.
    private static func inline(_ e: AXUIElement, _ a: Attrs, depth: Int, budget: inout Int) -> (String, [CGRect], CGFloat)? {
        let frames = a.frame.map { [$0] } ?? []
        let height = a.frame?.height ?? .greatestFiniteMagnitude
        switch a.role {
        case "AXStaticText":
            return (a.value ?? a.title ?? "", frames, height)
        case "AXListMarker":
            return ((a.value ?? a.title ?? "") + " ", frames, height)
        case "AXLink", "AXGroup":
            // Inline code, a link or a styled span: a few children, all inline. A block-level group (a whole
            // paragraph of its own) is caught by the caller's rule that text runs must sit directly inside.
            guard depth < 3, !a.children.isEmpty, a.children.count <= 30, budget > 0 else { return nil }
            var text = "", rects = frames, h = height
            for c in a.children {
                guard budget > 0 else { return nil }
                budget -= 1
                guard let item = inline(c, Attrs(c), depth: depth + 1, budget: &budget) else { return nil }
                text += item.0; rects += item.1; h = min(h, item.2)
            }
            // A group taller than about two lines is a block, not a span inside a line.
            if let f = a.frame, h < .greatestFiniteMagnitude, f.height > h * 2.2 { return nil }
            return (text, rects, h)
        default:
            return nil
        }
    }

    /// Visible lines of a text element with their own bounds, or nil when the element cannot report lines.
    private static func lines(of e: AXUIElement, value: String, region: CGRect) -> [LensSpan]? {
        let ns = value as NSString
        // Every number below comes from another app and can be NSNotFound (Int.max) or out of range: validate it
        // before any arithmetic, because Swift traps on integer overflow.
        let length = ns.length
        guard length > 0 else { return [] }
        var start = 0, end = length   // visible characters, end exclusive
        if let v = copy(e, kAXVisibleCharacterRangeAttribute), let r = cfRange(v),
           r.location >= 0, r.location < length, r.length > 0 {
            start = r.location
            end = r.location + min(r.length, length - r.location)
        }
        guard let first = lineIndex(e, start), let last = lineIndex(e, end - 1), last >= first else { return nil }
        let stop = last - first > maxLinesPerElement ? first + maxLinesPerElement : last
        var out: [LensSpan] = []
        var any = false
        for line in first...stop {
            guard let lrValue = param(e, kAXRangeForLineParameterizedAttribute, NSNumber(value: line)),
                  var lr = cfRange(lrValue), lr.length > 0, lr.location >= 0, lr.location < length,
                  let rangeArg = AXValueCreate(.cfRange, &lr),
                  let b = cgRect(param(e, kAXBoundsForRangeParameterizedAttribute, rangeArg)),
                  b.height > 0 else { continue }
            any = true
            guard b.intersects(region) else { continue }
            let loc = lr.location
            let len = min(lr.length, length - loc)
            let raw = ns.substring(with: NSRange(location: loc, length: len))
            let text = tidy(raw)
            let breakAfter = raw.last.map { $0.isNewline } ?? false
            if text.contains(where: { $0.isLetter }) { out.append(LensSpan(text: text, rect: b, singleLine: true, breakAfter: breakAfter)) }
        }
        return any ? out : nil
    }

    /// Line number of a character index, or nil when the app answers nothing sensible (NSNotFound, negative).
    private static func lineIndex(_ e: AXUIElement, _ index: Int) -> Int? {
        guard let n = int(param(e, kAXLineForIndexParameterizedAttribute, NSNumber(value: index))),
              (0...1_000_000).contains(n) else { return nil }
        return n
    }

    // MARK: text at the pointer (Translate at Pointer bubble)

    /// What the bubble translates: the selection when the pointer is on or near it, else the paragraph under the
    /// pointer. `anchor` is where the text sits on screen (global, top-left based).
    struct PointerText: Sendable {
        let text: String
        let anchor: CGRect
        let pid: pid_t
    }

    static let maxPointerText = 4000

    static func textAtPointer(_ p: CGPoint, excluding myPid: pid_t) -> PointerText? {
        let system = AXUIElementCreateSystemWide()
        AXUIElementSetMessagingTimeout(system, 0.5)
        if let s = selection(system, near: p, excluding: myPid) { return s }
        var hit: AXUIElement?
        guard AXUIElementCopyElementAtPosition(system, Float(p.x), Float(p.y), &hit) == .success, let el = hit else { return nil }
        var pid: pid_t = 0
        AXUIElementGetPid(el, &pid)
        guard pid != myPid else { return nil }
        AXUIElementSetMessagingTimeout(el, 0.5)
        guard let found = text(at: el, point: p) else { return nil }
        let clean = String(tidy(found.0).prefix(maxPointerText))
        guard clean.contains(where: { $0.isLetter }) else { return nil }
        return PointerText(text: clean, anchor: found.1, pid: pid)
    }

    /// Selected text of the focused element, when the pointer is on it or close to it (a selection left behind in
    /// another place must not win over what the user points at).
    private static func selection(_ system: AXUIElement, near p: CGPoint, excluding myPid: pid_t) -> PointerText? {
        guard let focused = element(copy(system, kAXFocusedUIElementAttribute)) else { return nil }
        var pid: pid_t = 0
        AXUIElementGetPid(focused, &pid)
        guard pid != myPid else { return nil }
        AXUIElementSetMessagingTimeout(focused, 0.5)
        if role(of: focused) == "AXSecureTextField" || (copy(focused, kAXSubroleAttribute) as? String) == "AXSecureTextField" { return nil }
        guard let selected = copy(focused, kAXSelectedTextAttribute) as? String else { return nil }
        let text = tidy(selected)
        guard text.contains(where: { $0.isLetter }) else { return nil }
        var anchor: CGRect?
        if let v = copy(focused, kAXSelectedTextRangeAttribute), var r = cfRange(v), r.location >= 0, r.length > 0,
           let arg = AXValueCreate(.cfRange, &r), let b = cgRect(param(focused, kAXBoundsForRangeParameterizedAttribute, arg)),
           b.width > 0 || b.height > 0 {
            anchor = b
        }
        // Without bounds, trust the selection only when the pointer is inside the focused element.
        let near = anchor ?? frame(of: focused) ?? .null
        guard !near.isNull, near.insetBy(dx: -60, dy: -60).contains(p) else { return nil }
        return PointerText(text: String(text.prefix(maxPointerText)), anchor: anchor ?? CGRect(origin: p, size: .zero), pid: pid)
    }

    /// The paragraph that contains `el`, or its own text.
    private static func text(at el: AXUIElement, point p: CGPoint) -> (String, CGRect)? {
        let a = Attrs(el)
        if a.role == "AXSecureTextField" || a.subrole == "AXSecureTextField" { return nil }
        if ["AXTextArea", "AXTextField", "AXComboBox"].contains(a.role), let value = a.value, !value.isEmpty {
            return editorParagraph(el, value: value, point: p) ?? a.frame.map { (value, $0) }
        }
        if titleRoles.contains(a.role), let t = a.title, !t.isEmpty, let f = a.frame { return (t, f) }

        // A text run: its paragraph is a parent (or a grandparent, when the run sits inside a link or inline code).
        var budget = 600
        var current: AXUIElement? = a.role == "AXStaticText" ? element(copy(el, kAXParentAttribute)) : el
        for _ in 0..<4 {
            guard let c = current, budget > 0 else { break }
            let ca = Attrs(c)
            var kids: [(AXUIElement, Attrs)] = []
            for k in ca.children.prefix(200) {
                guard budget > 0 else { break }
                budget -= 1
                kids.append((k, Attrs(k)))
            }
            if let para = paragraph(kids, budget: &budget) { return (para.text, para.rect) }
            // A paragraph with a single run (<p>plain text</p>).
            if kids.count == 1, kids[0].1.role == "AXStaticText", let t = kids[0].1.value, let f = kids[0].1.frame { return (t, f) }
            current = element(copy(c, kAXParentAttribute))
        }
        if a.role == "AXStaticText", let t = a.value ?? a.title, let f = a.frame { return (t, f) }
        return nil
    }

    /// The paragraph under the pointer inside an editor or a long text view.
    private static func editorParagraph(_ el: AXUIElement, value: String, point p: CGPoint) -> (String, CGRect)? {
        let ns = value as NSString
        var pt = p
        guard let arg = AXValueCreate(.cgPoint, &pt),
              let r = cfRange(param(el, kAXRangeForPositionParameterizedAttribute, arg)),
              r.location >= 0, r.location <= ns.length else { return nil }
        var range = ns.paragraphRange(for: NSRange(location: min(r.location, max(0, ns.length - 1)), length: 0))
        if range.length > 2000 { range = ns.lineRange(for: NSRange(location: min(r.location, max(0, ns.length - 1)), length: 0)) }
        if range.length > 2000 { range = NSRange(location: range.location, length: 2000) }
        let text = ns.substring(with: range)
        var cf = CFRange(location: range.location, length: range.length)
        let bounds = AXValueCreate(.cfRange, &cf).flatMap { cgRect(param(el, kAXBoundsForRangeParameterizedAttribute, $0)) }
        return (text, bounds ?? CGRect(origin: p, size: .zero))
    }

    private static func element(_ v: CFTypeRef?) -> AXUIElement? {
        guard let v, CFGetTypeID(v) == AXUIElementGetTypeID() else { return nil }
        return (v as! AXUIElement)
    }

    // MARK: post-processing

    /// Keeps the part of each span inside the region. A line cut by the top or bottom edge is dropped unless most
    /// of it shows; a block is clipped to the region.
    private static func clip(_ spans: [LensSpan], to region: CGRect) -> [LensSpan] {
        spans.compactMap { s in
            let i = s.rect.intersection(region)
            guard !i.isNull, i.width > 2, i.height > 2 else { return nil }
            if s.singleLine && i.height < s.rect.height * 0.6 { return nil }
            return LensSpan(text: s.text, rect: i, singleLine: s.singleLine, breakAfter: s.breakAfter)
        }
    }

    /// Joins pieces of one visual line (web pages split a line into runs at every link or bold word) into one
    /// span, in reading order: right to left for Hebrew and Arabic.
    static func merge(_ spans: [LensSpan]) -> [LensSpan] {
        let unique = Array(Set(spans))
        let sorted = unique.sorted { a, b in
            abs(a.rect.midY - b.rect.midY) > min(a.rect.height, b.rect.height) * 0.3 ? a.rect.midY < b.rect.midY : a.rect.minX < b.rect.minX
        }
        var out: [LensSpan] = []
        var group: [LensSpan] = []
        func flush() {
            guard let first = group.first else { return }
            if group.count == 1 { out.append(first); group.removeAll(); return }
            let joinedLTR = group.map(\.text).joined(separator: " ")
            let rtl = isRTL(joinedLTR)
            let ordered = rtl ? group.sorted { $0.rect.maxX > $1.rect.maxX } : group
            let rect = group.dropFirst().reduce(first.rect) { $0.union($1.rect) }
            out.append(LensSpan(text: ordered.map(\.text).joined(separator: " "), rect: rect, singleLine: true,
                                breakAfter: group.contains { $0.breakAfter }))
            group.removeAll()
        }
        for s in sorted {
            guard s.singleLine, let prev = group.last else {
                flush()
                if s.singleLine { group = [s] } else { out.append(s) }
                continue
            }
            let h = min(prev.rect.height, s.rect.height)
            let sameLine = abs(prev.rect.midY - s.rect.midY) < h * 0.35
            let similar = s.rect.height / max(prev.rect.height, 1) > 0.7 && s.rect.height / max(prev.rect.height, 1) < 1.4
            let gap = s.rect.minX - prev.rect.maxX
            if sameLine && similar && gap < h * 1.2 && gap > -h * 0.5 { group.append(s) } else { flush(); group = [s] }
        }
        flush()
        return out
    }

    /// Reading mode: consecutive lines of one paragraph (same left edge and line height, no gap) become one span,
    /// so editors and text views that report lines are translated paragraph by paragraph.
    static func joinLines(_ spans: [LensSpan]) -> [LensSpan] {
        var out: [LensSpan] = []
        for s in spans.sorted(by: { $0.rect.minY < $1.rect.minY }) {
            if let prev = out.last, s.singleLine, !prev.breakAfter {
                let h = s.rect.height
                let lastLineBottom = prev.rect.maxY
                let gap = s.rect.minY - lastLineBottom
                let sameEdge = abs(s.rect.minX - prev.rect.minX) < 6 || abs(s.rect.maxX - prev.rect.maxX) < 6
                let prevLine = prev.singleLine ? prev.rect.height : h
                if sameEdge && gap > -h * 0.3 && gap < h * 0.5 && abs(prevLine - h) < h * 0.25 && !endsParagraph(prev.text) {
                    out[out.count - 1] = LensSpan(text: prev.text + " " + s.text, rect: prev.rect.union(s.rect),
                                                  singleLine: false, breakAfter: s.breakAfter)
                    continue
                }
            }
            out.append(s)
        }
        return out
    }

    /// A line that ends with a colon or looks like a heading or list item starts a new paragraph after it.
    private static func endsParagraph(_ s: String) -> Bool {
        guard let last = s.trimmingCharacters(in: .whitespaces).last else { return true }
        return last == ":"
    }

    static func isRTL(_ s: String) -> Bool {
        var rtl = 0, ltr = 0
        for u in s.unicodeScalars {
            if (0x0590...0x08FF).contains(u.value) || (0xFB1D...0xFEFF).contains(u.value) { rtl += 1 }
            else if CharacterSet.letters.contains(u) { ltr += 1 }
        }
        return rtl > 0 && Double(rtl) / Double(rtl + ltr) >= 0.3
    }

    private static func tidy(_ s: String) -> String {
        s.replacingOccurrences(of: "\u{FFFC}", with: "")   // object replacement (inline images, attachments)
            .components(separatedBy: .newlines).map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }.joined(separator: " ")
    }

    // MARK: AX helpers

    /// The attributes one visit needs, fetched in a single IPC round trip.
    private struct Attrs {
        var role = "", subrole: String?, value: String?, title: String?
        var frame: CGRect?
        var children: [AXUIElement] = []

        private static let names = [kAXRoleAttribute, kAXSubroleAttribute, "AXFrame", kAXPositionAttribute,
                                    kAXSizeAttribute, kAXValueAttribute, kAXTitleAttribute, kAXChildrenAttribute] as CFArray

        init(_ e: AXUIElement) {
            var raw: CFArray?
            guard AXUIElementCopyMultipleAttributeValues(e, Self.names, AXCopyMultipleAttributeOptions(rawValue: 0), &raw) == .success,
                  let raw else { return }
            let v = (raw as NSArray) as [AnyObject]
            guard v.count == 8 else { return }
            role = v[0] as? String ?? ""
            subrole = v[1] as? String
            if let f = AXTextReader.cgRect(v[2]) { frame = f }
            else if let p = AXTextReader.cgPoint(v[3]), let s = AXTextReader.cgSize(v[4]) { frame = CGRect(origin: p, size: s) }
            value = v[5] as? String
            title = v[6] as? String
            children = (v[7] as? [AXUIElement]) ?? []
        }
    }

    private static func copy(_ e: AXUIElement, _ name: String) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
    }

    private static func param(_ e: AXUIElement, _ name: String, _ arg: CFTypeRef) -> CFTypeRef? {
        var v: CFTypeRef?
        return AXUIElementCopyParameterizedAttributeValue(e, name as CFString, arg, &v) == .success ? v : nil
    }

    private static func role(of e: AXUIElement) -> String? { copy(e, kAXRoleAttribute) as? String }

    private static func frame(of e: AXUIElement) -> CGRect? {
        if let f = cgRect(copy(e, "AXFrame")) { return f }
        guard let p = cgPoint(copy(e, kAXPositionAttribute)), let s = cgSize(copy(e, kAXSizeAttribute)) else { return nil }
        return CGRect(origin: p, size: s)
    }

    private static func axValue(_ v: CFTypeRef?, _ type: AXValueType) -> AXValue? {
        guard let v, CFGetTypeID(v) == AXValueGetTypeID() else { return nil }
        let ax = v as! AXValue
        return AXValueGetType(ax) == type ? ax : nil
    }

    static func cgRect(_ v: CFTypeRef?) -> CGRect? {
        guard let ax = axValue(v, .cgRect) else { return nil }
        var r = CGRect.zero
        return AXValueGetValue(ax, .cgRect, &r) ? r : nil
    }

    static func cgPoint(_ v: CFTypeRef?) -> CGPoint? {
        guard let ax = axValue(v, .cgPoint) else { return nil }
        var p = CGPoint.zero
        return AXValueGetValue(ax, .cgPoint, &p) ? p : nil
    }

    static func cgSize(_ v: CFTypeRef?) -> CGSize? {
        guard let ax = axValue(v, .cgSize) else { return nil }
        var s = CGSize.zero
        return AXValueGetValue(ax, .cgSize, &s) ? s : nil
    }

    private static func cfRange(_ v: CFTypeRef?) -> CFRange? {
        guard let ax = axValue(v, .cfRange) else { return nil }
        var r = CFRange()
        return AXValueGetValue(ax, .cfRange, &r) ? r : nil
    }

    private static func int(_ v: CFTypeRef?) -> Int? { (v as? NSNumber)?.intValue }
}
