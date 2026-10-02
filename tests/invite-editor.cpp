#include "Processor.h"
#include <iostream>

// Interactive verification uses the same processor and editor as VST3/AU,
// with a quiet synthetic stereo input and no microphone or device permissions.
class InvitePreview final : public juce::JUCEApplication, private juce::Timer {
public:
    const juce::String getApplicationName() override{return "SessionStream invite verification";}
    const juce::String getApplicationVersion() override{return UpdateChecker::currentVersion;}
    void initialise(const juce::String&) override {
        processor=std::make_unique<StreamProcessor>([]{return juce::String(UpdateChecker::currentVersion);});
        processor->prepareToPlay(48000,480);
        buffer.setSize(2,480);
        window=std::make_unique<Window>();window->setContentOwned(processor->createEditor(),true);window->centreWithSize(560,508);window->setVisible(true);
        startTimer(10);
    }
    void shutdown() override{stopTimer();window.reset();processor.reset();}
private:
    struct Window : juce::DocumentWindow {
        Window():DocumentWindow("SessionStream 0.30 invite verification",juce::Colours::black,DocumentWindow::closeButton){setUsingNativeTitleBar(true);}
        void closeButtonPressed() override{juce::JUCEApplication::getInstance()->systemRequestedQuit();}
    };
    std::unique_ptr<StreamProcessor> processor;std::unique_ptr<Window> window;
    juce::AudioBuffer<float> buffer;juce::MidiBuffer midi;double phase=0;juce::String previous;int ticks=0;
    void timerCallback() override {
        for(int i=0;i<480;i++){buffer.setSample(0,i,static_cast<float>(.08*std::sin(phase)));buffer.setSample(1,i,static_cast<float>(.04*std::sin(phase*.5)));phase+=juce::MathConstants<double>::twoPi*440/48000;}
        processor->processBlock(buffer,midi);
        if(++ticks==200){
            const auto path=juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_SNAPSHOT",{});
            if(path.isNotEmpty()){
                auto image=window->getContentComponent()->createComponentSnapshot(window->getContentComponent()->getLocalBounds(),true,2.0f);
                juce::File file(path);auto output=file.createOutputStream();
                if(output){output->setPosition(0);output->truncate();juce::PNGImageFormat format;format.writeImageToStream(image,*output);std::cout<<"SNAPSHOT_SAVED"<<std::endl;}
            }
        }
        const auto s=processor->controller->status();
        const auto state=s.message+" | protected="+juce::String(static_cast<int>(s.passcodeRequired))+" | warning="+juce::String(static_cast<int>(s.warning))+" | "+s.link;
        if(state!=previous){std::cout<<"STATE: "<<state<<std::endl;previous=state;}
    }
};
START_JUCE_APPLICATION(InvitePreview)
