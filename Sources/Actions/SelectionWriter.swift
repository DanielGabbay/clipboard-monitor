import Cocoa
import Carbon
import ApplicationServices

// MARK: - Writing the result of an action back in place of the selection
//
// First choice: set the selected text of the element the selection was read from (no clipboard involved). Apps
// that refuse, or that say yes and do nothing (Chromium), get a paste instead: the result goes on the pasteboard,
// ⌘V is posted to the app, and the previous pasteboard contents come back a moment later.

enum SelectionWriter {
    /// Runs on the accessibility queue. True when the app replaced the selection.
    static func replaceViaAccessibility(_ sel: TextSelection, with text: String) -> Bool {
        guard let el = sel.element else { return false }
        AXUIElementSetMessagingTimeout(el, SelectionReader.timeout)
        var settable: DarwinBoolean = false
        guard AXUIElementIsAttributeSettable(el, kAXSelectedTextAttribute as CFString, &settable) == .success,
              settable.boolValue else { return false }
        // The selection must still be the text the action ran on.
        guard (AXTextReader.copy(el, kAXSelectedTextAttribute) as? String) == sel.raw else { return false }
        if text == sel.raw { return true }
        guard AXUIElementSetAttributeValue(el, kAXSelectedTextAttribute as CFString, text as CFString) == .success else { return false }
        // An app that took the value no longer reports the old selection.
        return (AXTextReader.copy(el, kAXSelectedTextAttribute) as? String) != sel.raw
    }

    /// Main thread. Brings the app forward, pastes `text` over its selection and restores the pasteboard.
    @MainActor
    static func replaceFrontmost(with text: String) -> Bool {
        if let sel = SelectionReader.readFrontmostSelection() {
            if replaceViaAccessibility(sel, with: text) { return true }
            replaceViaPaste(pid: sel.pid, with: text)
            return true
        }
        return false
    }

    @MainActor
    static func replaceViaPaste(pid: pid_t, with text: String) {
        guard let d = NSApp.delegate as? AppDelegate else { return }
        d.suppressClipboard(for: 2.0)
        let snapshot = PasteboardSnapshot.take()
        NSRunningApplication(processIdentifier: pid)?.activate()
        let pb = NSPasteboard.general
        pb.clearContents()
        pb.setString(text, forType: .string)
        // Give the app a moment to become active and take back its key window.
        DispatchQueue.global(qos: .userInitiated).asyncAfter(deadline: .now() + 0.2) {
            Keystroke.waitForModifiersUp()
            Keystroke.post(CGKeyCode(kVK_ANSI_V), flags: .maskCommand)
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.7) {
                snapshot.restore()
                (NSApp.delegate as? AppDelegate)?.suppressClipboard(for: 0.8)
            }
        }
    }
}
