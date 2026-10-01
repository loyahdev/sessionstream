#include "Processor.h"
class UpdatePreview final : public juce::JUCEApplication {
public:
    const juce::String getApplicationName() override{return "SessionStream update verification";}
    const juce::String getApplicationVersion() override{return UpdateChecker::currentVersion;}
    void initialise(const juce::String&) override {
        processor=std::make_unique<StreamProcessor>([]{return juce::String("0.21");});
        window=std::make_unique<Window>();window->setContentOwned(processor->createEditor(),true);window->centreWithSize(560,608);window->setVisible(true);
    }
    void shutdown() override{window.reset();processor.reset();}
private:
    struct Window : juce::DocumentWindow {
        Window():DocumentWindow("SessionStream update verification",juce::Colours::black,DocumentWindow::closeButton){setUsingNativeTitleBar(true);}
        void closeButtonPressed() override{juce::JUCEApplication::getInstance()->systemRequestedQuit();}
    };
    std::unique_ptr<StreamProcessor> processor;std::unique_ptr<Window> window;
};
START_JUCE_APPLICATION(UpdatePreview)
