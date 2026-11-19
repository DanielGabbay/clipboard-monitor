import Cocoa
import Vision
import CoreGraphics
import ImageIO

enum OCRReader {
    /// Extracts plain text from a CGImage using Apple's Vision framework.
    static func recognizeText(from image: CGImage) -> String? {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(macOS 13.0, *) {
            request.recognitionLanguages = ["he-IL", "he", "en-US", "en"]
        }

        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return nil
        }

        guard let observations = request.results else { return nil }
        var lines: [String] = []
        for obs in observations {
            if let candidate = obs.topCandidates(1).first {
                let trimmed = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
                if !trimmed.isEmpty {
                    lines.append(candidate.string)
                }
            }
        }
        guard !lines.isEmpty else { return nil }
        return lines.joined(separator: "\n")
    }

    /// Extracts text from image Data (e.g. PNG/JPEG bytes from a clipboard item).
    static func recognizeText(from data: Data) -> String? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let cgImage = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
            return nil
        }
        return recognizeText(from: cgImage)
    }

    /// Captures the screen region below `windowNumber` (or current display) and recognizes text spans for Lens.
    static func recognizeSpans(in region: CGRect, belowWindowNumber: Int?) -> [LensSpan] {
        guard region.width > 2 && region.height > 2 else { return [] }

        let primaryHeight = NSScreen.screens.first?.frame.height ?? 1080
        // Convert AppKit rect (origin bottom-left) to CGWindow rect (origin top-left)
        let cgRect = CGRect(
            x: region.origin.x,
            y: primaryHeight - (region.origin.y + region.height),
            width: region.width,
            height: region.height
        )

        let windowId = CGWindowID(belowWindowNumber ?? 0)
        typealias WindowImageFunc = @convention(c) (CGRect, UInt32, CGWindowID, UInt32) -> Unmanaged<CGImage>?
        guard let sym = dlsym(dlopen(nil, RTLD_NOW), "CGWindowListCreateImage") else { return [] }
        let fn = unsafeBitCast(sym, to: WindowImageFunc.self)
        guard let unmanaged = fn(cgRect, 2 /* .optionOnScreenBelowWindow */, windowId, 1 /* .bestResolution */) else {
            return []
        }
        let cgImage = unmanaged.takeRetainedValue()

        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.usesLanguageCorrection = true
        if #available(macOS 13.0, *) {
            request.recognitionLanguages = ["he-IL", "he", "en-US", "en"]
        }

        let handler = VNImageRequestHandler(cgImage: cgImage, options: [:])
        do {
            try handler.perform([request])
        } catch {
            return []
        }

        guard let observations = request.results else { return [] }
        var spans: [LensSpan] = []
        for obs in observations {
            guard let candidate = obs.topCandidates(1).first else { continue }
            let text = candidate.string.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !text.isEmpty else { continue }

            let box = obs.boundingBox
            let spanX = region.origin.x + box.origin.x * region.width
            let spanY = region.origin.y + box.origin.y * region.height
            let spanW = box.size.width * region.width
            let spanH = box.size.height * region.height
            let spanRect = CGRect(x: spanX, y: spanY, width: spanW, height: spanH)

            spans.append(LensSpan(text: text, rect: spanRect, singleLine: true, breakAfter: true))
        }
        return spans
    }
}
