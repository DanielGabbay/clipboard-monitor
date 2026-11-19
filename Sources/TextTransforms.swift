import Foundation

/// Pure, zero-dependency text transformation primitives shared across the app (Clipboard Monitor, Text Actions,
/// global shortcuts, Services, URL schemes, CLI, and MCP).
enum TextTransforms {
    // Matches Resources/renderer.js CONTROLS, HEB, and PREFIX
    private static let controlsRE = try! NSRegularExpression(pattern: "[\\u2066-\\u2069\\u202A-\\u202E\\u200E\\u200F\\u061C]")
    private static let hebRE = try! NSRegularExpression(pattern: "[\\u0590-\\u05FF\\uFB1D-\\uFB4F\\u0600-\\u06FF]")
    private static let fenceRE = try! NSRegularExpression(pattern: "^\\s*(?:```|~~~)")
    private static let prefixRE = try! NSRegularExpression(pattern: "^(\\s*(?:[-*+]\\s+|\\d+[.)]\\s+|>\\s*|#{1,6}\\s+|\\|\\s*)*)")

    /// Wraps lines containing Hebrew/Arabic letters in Unicode RLI...PDI isolates (`\u{2067}...\u{2069}`),
    /// preserving leading Markdown/list prefixes and leaving fenced code blocks untouched.
    /// Idempotent: strips existing directional control characters before re-wrapping.
    static func wrapRtl(_ text: String) -> String {
        guard !text.isEmpty else { return text }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        var inFence = false
        return normalized.components(separatedBy: "\n").map { line in
            let nsClean = controlsRE.stringByReplacingMatches(
                in: line,
                range: NSRange(location: 0, length: (line as NSString).length),
                withTemplate: ""
            ) as NSString
            let fullRange = NSRange(location: 0, length: nsClean.length)
            let cleanStr = nsClean as String
            if fenceRE.firstMatch(in: cleanStr, range: fullRange) != nil {
                inFence.toggle()
                return cleanStr
            }
            if inFence || cleanStr.trimmingCharacters(in: .whitespaces).isEmpty || hebRE.firstMatch(in: cleanStr, range: fullRange) == nil {
                return cleanStr
            }
            let preLen = prefixRE.firstMatch(in: cleanStr, range: fullRange)?.range.length ?? 0
            let pre = nsClean.substring(to: preLen)
            let body = nsClean.substring(from: preLen)
            if body.trimmingCharacters(in: .whitespaces).isEmpty { return cleanStr }
            return pre + "\u{2067}" + body + "\u{2069}"
        }.joined(separator: "\n")
    }

    // Standard Israeli SI-1452 <-> US QWERTY directional maps (including final letters and macOS Hebrew geresh/gershayim)
    private static let enToHe: [Character: Character] = [
        // Top row
        "q": "/", "w": "'", "e": "ק", "r": "ר", "t": "א", "y": "ט", "u": "ו", "i": "ן", "o": "ם", "p": "פ",
        "[": "]", "]": "[", "{": "}", "}": "{",
        // Home row
        "a": "ש", "s": "ד", "d": "ג", "f": "כ", "g": "ע", "h": "י", "j": "ח", "k": "ל", "l": "ך",
        ";": "ף", "'": ",",
        // Bottom row
        "z": "ז", "x": "ס", "c": "ב", "v": "ה", "b": "נ", "n": "מ", "m": "צ",
        ",": "ת", ".": "ץ", "/": ".",
        // Backtick
        "`": ";",
    ]

    private static let heToEn: [Character: Character] = [
        // Top row
        "/": "q", "'": "w", "\u{05F3}": "w", "ק": "e", "ר": "r", "א": "t", "ט": "y", "ו": "u", "ן": "i", "ם": "o", "פ": "p",
        "]": "[", "[": "]", "}": "{", "{": "}",
        // Home row
        "ש": "a", "ד": "s", "ג": "d", "כ": "f", "ע": "g", "י": "h", "ח": "j", "ל": "k", "ך": "l",
        "ף": ";", ",": "'",
        // Bottom row
        "ז": "z", "ס": "x", "ב": "c", "ה": "v", "נ": "b", "מ": "n", "צ": "m",
        "ת": ",", "ץ": ".", ".": "/",
        // Semicolon & macOS gershayim
        ";": "`", "\u{05F4}": "\"",
    ]

    /// Bidirectional Hebrew SI-1452 <-> English QWERTY keyboard layout converter.
    /// Direction is chosen by whole-string script majority (`hebrewCount > latinCount`).
    static func flipKeyboard(_ text: String) -> String {
        guard !text.isEmpty else { return text }
        var hebrewCount = 0
        var latinCount = 0
        for scalar in text.unicodeScalars {
            let v = scalar.value
            if (0x0590...0x05FF).contains(v) { hebrewCount += 1 }
            else if (0x41...0x5A).contains(v) || (0x61...0x7A).contains(v) { latinCount += 1 }
        }
        let toEnglish = hebrewCount > latinCount
        var result = String()
        result.reserveCapacity(text.count)
        for ch in text {
            if toEnglish {
                result.append(heToEn[ch] ?? ch)
            } else {
                let lower = ch.isASCII && ch.isUppercase ? Character(ch.lowercased()) : ch
                result.append(enToHe[lower] ?? ch)
            }
        }
        return result
    }

    /// Normalizes line endings to `\n`, strips trailing horizontal whitespace per line, collapses internal runs of
    /// spaces/tabs to a single space while preserving leading indentation on non-empty lines, collapses 3+ newlines
    /// into a single blank line (`\n\n`), and strips leading/trailing blank lines.
    static func cleanWhitespace(_ text: String) -> String {
        guard !text.isEmpty else { return text }
        let normalized = text.replacingOccurrences(of: "\r\n", with: "\n").replacingOccurrences(of: "\r", with: "\n")
        let cleanedLines: [String] = normalized.components(separatedBy: "\n").map { line in
            var s = line
            while let last = s.last, last == " " || last == "\t" { s.removeLast() }
            if s.isEmpty { return "" }
            let indentEnd = s.firstIndex(where: { $0 != " " && $0 != "\t" }) ?? s.endIndex
            let indent = s[..<indentEnd]
            let body = s[indentEnd...]
            var collapsed = ""
            collapsed.reserveCapacity(body.count)
            var prevSpace = false
            for ch in body {
                if ch == " " || ch == "\t" {
                    if !prevSpace { collapsed.append(" "); prevSpace = true }
                } else {
                    collapsed.append(ch)
                    prevSpace = false
                }
            }
            return String(indent) + collapsed
        }
        var out: [String] = []
        var blankRun = 0
        for line in cleanedLines {
            if line.isEmpty {
                if out.isEmpty { continue }
                blankRun += 1
                if blankRun <= 1 { out.append("") }
            } else {
                blankRun = 0
                out.append(line)
            }
        }
        while out.last?.isEmpty == true { out.removeLast() }
        return out.joined(separator: "\n")
    }
}
