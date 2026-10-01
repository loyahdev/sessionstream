#include "InviteQR.h"
#include <juce_graphics/juce_graphics.h>
#include <iostream>

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    const juce::String invite = "https://sessionstream-private-test.trycloudflare.com/listen/abc-123#0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ-_";
    InviteQR qr(invite);
    if (qr.getEncodedInvite() != invite || qr.getError().isNotEmpty()) return 1;
    const auto image = qr.getQRCodeImage();
    if (!image.isValid() || image.getWidth() > InviteQR::imageEdge || image.getWidth() != image.getHeight()) return 2;
    const auto matrix = qrcodegen::QrCode::encodeText(invite.toRawUTF8(), qrcodegen::QrCode::Ecc::MEDIUM);
    const int size = matrix.getSize(), modules = size + InviteQR::quietZoneModules * 2;
    if (image.getWidth() % modules) return 3;
    const int scale = image.getWidth() / modules;
    for (int y = 0; y < image.getHeight(); ++y) {
        for (int x = 0; x < image.getWidth(); ++x) {
            const int mx = x / scale - InviteQR::quietZoneModules, my = y / scale - InviteQR::quietZoneModules;
            const auto expected = matrix.getModule(mx, my) ? juce::Colours::black : juce::Colours::white;
            if (image.getPixelAt(x, y) != expected) return 4;
        }
    }
    if (argc > 1) {
        juce::File output = juce::File::getCurrentWorkingDirectory().getChildFile(argv[1]);
        auto stream = output.createOutputStream();
        if (!stream || !juce::PNGImageFormat().writeImageToStream(image, *stream)) return 5;
    }
    if (qr.setInvite({}) || qr.getError().isEmpty() || qr.getEncodedInvite().isNotEmpty()) return 6;
    if (qr.setInvite(juce::String::repeatedString("x", 1025)) || qr.getError().isEmpty()) return 7;
    if (!qr.setInvite(invite)) return 8;
    std::cout << "PASS: exact private URL, integer modules, four-module white quiet zone, PNG rendering, empty/oversized error handling\n";
}
