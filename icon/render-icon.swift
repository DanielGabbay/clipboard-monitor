// Renders the SVG app icon to a square PNG with AppKit (macOS 13+ reads SVG natively).
//   render-icon in.svg out.png 1024
import AppKit

let args = CommandLine.arguments
guard args.count == 4, let image = NSImage(contentsOfFile: args[1]), let size = Int(args[3]) else {
    FileHandle.standardError.write("usage: render-icon in.svg out.png size\n".data(using: .utf8)!)
    exit(1)
}
guard let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                                 samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                                 bytesPerRow: 0, bitsPerPixel: 0) else { exit(1) }
NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
image.draw(in: NSRect(x: 0, y: 0, width: size, height: size))
NSGraphicsContext.restoreGraphicsState()
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: URL(fileURLWithPath: args[2]))
