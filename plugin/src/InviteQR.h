#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "../third_party/qrcodegen.hpp"

// The invite stays on this computer. No QR service receives the private URL.
class InviteQR final : public juce::Component {
public:
    static constexpr int quietZoneModules = 4;
    static constexpr int imageEdge = 288;
    std::function<void()> onClose;

    explicit InviteQR(const juce::String& link = {}) {
        setSize(320, 390);
        addAndMakeVisible(close);
        close.setButtonText("Close");
        close.setColour(juce::TextButton::buttonColourId, juce::Colour(0xff29382d));
        close.setColour(juce::TextButton::textColourOffId, juce::Colour(0xffd8f8c3));
        close.onClick = [this] {
            if (onClose) { onClose(); return; }
            if (auto* callout = findParentComponentOfClass<juce::CallOutBox>())
                callout->dismiss();
        };
        setInvite(link);
    }

    bool setInvite(const juce::String& link) {
        image = {};
        encodedInvite.clear();
        error.clear();
        if (link.isEmpty()) {
            error = "Generate a share link first.";
        } else if (link.getNumBytesAsUTF8() > 1024) {
            error = "This link is too long for the QR code.";
        } else {
            try {
                const auto code = qrcodegen::QrCode::encodeText(link.toRawUTF8(), qrcodegen::QrCode::Ecc::MEDIUM);
                const int modules = code.getSize() + quietZoneModules * 2;
                const int scale = imageEdge / modules;
                if (scale < 2) {
                    error = "This link is too long for a readable QR code.";
                } else {
                    image = juce::Image(juce::Image::RGB, modules * scale, modules * scale, true);
                    juce::Graphics g(image);
                    g.fillAll(juce::Colours::white);
                    g.setColour(juce::Colours::black);
                    for (int y = 0; y < code.getSize(); ++y)
                        for (int x = 0; x < code.getSize(); ++x)
                            if (code.getModule(x, y))
                                g.fillRect((x + quietZoneModules) * scale, (y + quietZoneModules) * scale, scale, scale);
                    encodedInvite = link;
                }
            } catch (const std::exception&) {
                error = "Could not generate this QR code. Copy the link instead.";
            }
        }
        repaint();
        return image.isValid();
    }

    const juce::Image& getQRCodeImage() const noexcept { return image; }
    juce::String getEncodedInvite() const { return encodedInvite; }
    juce::String getError() const { return error; }

    void resized() override { close.setBounds(20, getHeight() - 49, getWidth() - 40, 33); }

    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colours::white);
        g.setColour(juce::Colour(0xff141917));
        g.setFont(juce::FontOptions(18));
        g.drawText("Scan to listen", 16, 10, getWidth() - 32, 27, juce::Justification::centred);
        if (image.isValid()) {
            // Draw at native size so each QR module has integer pixel edges.
            g.drawImageAt(image, (getWidth() - image.getWidth()) / 2, 43 + (imageEdge - image.getHeight()) / 2);
        } else {
            g.setFont(juce::FontOptions(14));
            g.drawFittedText(error, 24, 65, getWidth() - 48, imageEdge - 50, juce::Justification::centred, 3);
        }
        g.setFont(juce::FontOptions(11));
        g.drawText("Open your phone camera and point it here.", 12, getHeight() - 69, getWidth() - 24, 18, juce::Justification::centred);
    }

private:
    juce::Image image;
    juce::String encodedInvite, error;
    juce::TextButton close;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(InviteQR)
};
