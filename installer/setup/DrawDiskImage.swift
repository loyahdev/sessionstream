import AppKit

private let panel = NSColor(srgbRed: 0.07, green: 0.11, blue: 0.08, alpha: 1)
private let recess = NSColor(srgbRed: 0.041, green: 0.067, blue: 0.051, alpha: 1)
private let ink = NSColor(srgbRed: 0.93, green: 0.95, blue: 0.91, alpha: 1)
private let lime = NSColor(srgbRed: 0.76, green: 0.91, blue: 0.47, alpha: 1)
private let panelSplit: CGFloat = 322
private let backgroundHeight: CGFloat = 381
private let coverHeight: CGFloat = 321

private struct Drawing {
    let context: CGContext
    let height: CGFloat

    func point(_ x: CGFloat, _ y: CGFloat) -> CGPoint {
        CGPoint(x: x, y: height - y)
    }

    func rect(_ x: CGFloat, _ y: CGFloat, _ width: CGFloat, _ height: CGFloat) -> CGRect {
        CGRect(x: x, y: self.height - y - height, width: width, height: height)
    }

    func fill(_ x: CGFloat, _ y: CGFloat, _ w: CGFloat, _ h: CGFloat, _ color: NSColor) {
        context.setFillColor(color.cgColor)
        context.fill(rect(x, y, w, h))
    }

    func stroke(_ points: [(CGFloat, CGFloat)], width: CGFloat, color: NSColor) {
        context.setStrokeColor(color.cgColor)
        context.setLineWidth(width)
        context.setLineCap(.round)
        context.setLineJoin(.round)
        context.addLines(between: points.map { x, y in point(x, y) })
        context.strokePath()
    }

    func text(_ value: String, x: CGFloat, y: CGFloat, font: NSFont, color: NSColor) {
        let string = NSAttributedString(string: value, attributes: [.font: font, .foregroundColor: color])
        string.draw(at: point(x, y + string.size().height))
    }

    func mark(x: CGFloat, y: CGFloat, unit: CGFloat, color: NSColor) {
        context.setStrokeColor(color.cgColor)
        context.setLineCap(.round)
        context.setLineWidth(3 * unit)
        for offset in [CGFloat(0), 9, 18] {
            let baseline = y + offset * unit
            context.move(to: point(x, baseline + 11 * unit))
            context.addCurve(to: point(x + 26 * unit, baseline),
                             control1: point(x + 7 * unit, baseline - unit),
                             control2: point(x + 18 * unit, baseline + 13 * unit))
        }
        context.strokePath()
    }

}

private func render(width: Int, height: Int, scale: Int, to url: URL, draw: (Drawing) -> Void) throws {
    guard let bitmap = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: width * scale, pixelsHigh: height * scale,
                                        bitsPerSample: 8, samplesPerPixel: 4, hasAlpha: true, isPlanar: false,
                                        colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0),
          let graphics = NSGraphicsContext(bitmapImageRep: bitmap) else {
        throw CocoaError(.fileWriteUnknown)
    }
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = graphics
    graphics.cgContext.scaleBy(x: CGFloat(scale), y: CGFloat(scale))
    draw(Drawing(context: graphics.cgContext, height: CGFloat(height)))
    NSGraphicsContext.restoreGraphicsState()
    bitmap.size = NSSize(width: width, height: height)
    guard let png = bitmap.representation(using: .png, properties: [:]) else {
        throw CocoaError(.fileWriteUnknown)
    }
    try png.write(to: url)
}

private func drawCover(_ art: Drawing, photo: CGImage) {
    art.fill(0, 0, panelSplit, backgroundHeight, panel)
    let cover = art.rect(0, 0, panelSplit, backgroundHeight)
    let photoScale = max(cover.width / CGFloat(photo.width), cover.height / CGFloat(photo.height))
    let width = CGFloat(photo.width) * photoScale
    let height = CGFloat(photo.height) * photoScale
    art.context.saveGState()
    art.context.clip(to: cover)
    art.context.interpolationQuality = .high
    art.context.draw(photo, in: CGRect(x: -(width - cover.width) * 0.62,
                                      y: cover.minY + (cover.height - height) / 2,
                                      width: width, height: height))
    let shade = [
        panel.withAlphaComponent(0.78).cgColor,
        panel.withAlphaComponent(0.91).cgColor,
        panel.withAlphaComponent(0.82).cgColor,
        panel.withAlphaComponent(0.14).cgColor
    ]
    if let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB),
                                 colors: shade as CFArray, locations: [0, 0.29, 0.48, 0.9]) {
        art.context.drawLinearGradient(gradient, start: art.point(0, 0), end: art.point(0, coverHeight),
                                      options: [.drawsBeforeStartLocation, .drawsAfterEndLocation])
    }
    art.context.restoreGState()

    art.mark(x: 33, y: 28, unit: 0.66, color: lime)
    art.text("SessionStream", x: 30, y: 122,
             font: .systemFont(ofSize: 40, weight: .semibold), color: ink)
    art.text("Your DAW. Their browser.", x: 32, y: 178,
             font: .systemFont(ofSize: 15, weight: .medium), color: ink)
}

private func artwork(_ art: Drawing, photo: CGImage) {
    let paper = NSColor(srgbRed: 0.90, green: 0.93, blue: 0.85, alpha: 1)
    art.fill(0, 0, 620, backgroundHeight, paper)
    drawCover(art, photo: photo)
    art.text("Double-click to open", x: 402, y: 226,
             font: .systemFont(ofSize: 14, weight: .semibold), color: recess)
}

private func icon(_ art: Drawing, uninstall: Bool) {
    let outer = CGPath(roundedRect: art.rect(50, 47, 412, 418), cornerWidth: 89, cornerHeight: 89, transform: nil)
    let face = uninstall ? NSColor(srgbRed: 0.96, green: 0.66, blue: 0.50, alpha: 1) : panel
    let edge = uninstall ? NSColor(srgbRed: 0.76, green: 0.43, blue: 0.32, alpha: 1) : recess
    let glyph = uninstall ? NSColor(srgbRed: 0.25, green: 0.11, blue: 0.09, alpha: 1) : lime
    art.context.saveGState()
    art.context.addPath(outer)
    art.context.clip()
    art.fill(50, 47, 412, 418, edge)
    art.fill(50, 47, 412, 397, face)
    art.mark(x: 104, y: 103, unit: 1.65, color: glyph)

    if uninstall {
        art.stroke([(222, 202), (222, 175), (290, 175), (290, 202)], width: 19, color: glyph)
        art.stroke([(157, 203), (355, 203)], width: 24, color: glyph)
        art.stroke([(177, 207), (194, 351), (318, 351), (335, 207)], width: 22, color: glyph)
        art.stroke([(232, 246), (232, 307)], width: 17, color: glyph)
        art.stroke([(280, 246), (280, 307)], width: 17, color: glyph)
    } else {
        art.stroke([(256, 155), (256, 282)], width: 24, color: glyph)
        art.stroke([(200, 226), (256, 282), (312, 226)], width: 24, color: glyph)
        art.stroke([(153, 294), (153, 351), (359, 351), (359, 294)], width: 24, color: glyph)
    }
    art.context.restoreGState()
}

let output = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
let photoURL = URL(fileURLWithPath: CommandLine.arguments[2])
guard let source = NSImage(contentsOf: photoURL),
      let photo = source.cgImage(forProposedRect: nil, context: nil, hints: nil) else {
    throw CocoaError(.fileReadCorruptFile)
}
for scale in [1, 2] {
    let name = scale == 1 ? "Background.png" : "Background@2x.png"
    try render(width: 620, height: Int(backgroundHeight), scale: scale, to: output.appendingPathComponent(name)) {
        artwork($0, photo: photo)
    }
}
try render(width: Int(panelSplit), height: Int(coverHeight), scale: 2, to: output.appendingPathComponent("Cover.png")) {
    drawCover($0, photo: photo)
}
for (name, uninstall) in [("Setup", false), ("Uninstall", true)] {
    try render(width: 512, height: 512, scale: 2, to: output.appendingPathComponent("\(name).png")) {
        icon($0, uninstall: uninstall)
    }
}
