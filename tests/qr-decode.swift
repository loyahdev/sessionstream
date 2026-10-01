import Foundation
import Vision

let arguments = CommandLine.arguments
guard arguments.count >= 2 else {
    fputs("Usage: qr-decode image.png [expected URL]\n", stderr)
    exit(2)
}
let expected = arguments.count >= 3 ? arguments[2] : "https://sessionstream-private-test.trycloudflare.com/listen/abc-123#0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_"
let request = VNDetectBarcodesRequest()
request.symbologies = [.qr]
do {
    try VNImageRequestHandler(url: URL(fileURLWithPath: arguments[1])).perform([request])
    guard let results = request.results, results.count == 1,
          results[0].payloadStringValue == expected else {
        fputs("FAIL: QR did not decode to the exact invite\n", stderr)
        exit(1)
    }
    print("PASS: macOS Vision independently decoded the exact private invite, including URL fragment")
} catch {
    fputs("FAIL: QR decoder could not read the image: \(error.localizedDescription)\n", stderr)
    exit(1)
}
