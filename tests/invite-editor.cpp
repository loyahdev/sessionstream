#include "Processor.h"
#include <iostream>
#include "EditorWorkflow.h"

// Interactive verification uses the same processor and editor as VST3/AU,
// with a quiet synthetic stereo input and no microphone or device permissions.
class InvitePreview final : public juce::JUCEApplication, private juce::Timer {
public:
    const juce::String getApplicationName() override{return "SessionStream invite verification";}
    const juce::String getApplicationVersion() override{return UpdateChecker::currentVersion;}
    void initialise(const juce::String&) override {
        const auto previewFile=juce::File::getSpecialLocation(juce::File::currentExecutableFile).getSiblingFile("preview.json");
        const auto preview=juce::JSON::parse(previewFile);
        const auto configuredEndpoint=preview["endpoint"].toString();
        const bool isolated=configuredEndpoint.startsWith("http://127.0.0.1:")&&int(preview["udpPort"])>=1024&&int(preview["udpPort"])<=65535;
        const auto endpoint=isolated?configuredEndpoint:juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_ENDPOINT",{});
        const int udpPort=isolated?int(preview["udpPort"]):juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_UDP_PORT","49300").getIntValue();
        processor=std::make_unique<StreamProcessor>([]{return juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_WORKFLOW",{})=="1"?juce::String("1.1"):juce::String(UpdateChecker::currentVersion);},udpPort);
        if(endpoint.isNotEmpty())processor->controller=std::make_unique<StreamController>(processor->transport.getSourceId(),[this]{return processor->isSending();},endpoint);
        if(juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_RECEIVE_PREVIEW",{})=="1")processor->setReceiveMode(true);
        if(juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_FORMAT_PREVIEW",{})=="1"){auto layout=processor->getBusesLayout();layout.inputBuses.set(0,juce::AudioChannelSet::create5point1());layout.outputBuses.set(0,juce::AudioChannelSet::create5point1());processor->setBusesLayout(layout);processor->streamQuality=7;processor->streamChannels=6;}
        processor->prepareToPlay(48000,480);
        buffer.setSize(processor->getMainBusNumInputChannels(),480);buffer.clear();
        window=std::make_unique<Window>();window->setContentOwned(processor->createEditor(),true);window->centreWithSize(window->getWidth(),window->getHeight());window->setVisible(true);
        if(juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_WORKFLOW",{})=="1")workflow=std::make_unique<EditorWorkflow>();
        startTimer(10);
    }
    void shutdown() override{stopTimer();window.reset();processor.reset();}
private:
    struct Window : juce::DocumentWindow {
        Window():DocumentWindow("SessionStream 1.0 invite verification",juce::Colours::black,DocumentWindow::closeButton){setUsingNativeTitleBar(true);}
        void closeButtonPressed() override{juce::JUCEApplication::getInstance()->systemRequestedQuit();}
    };
    std::unique_ptr<EditorWorkflow> workflow;std::unique_ptr<StreamProcessor> processor;std::unique_ptr<Window> window;
    juce::AudioBuffer<float> buffer;juce::MidiBuffer midi;double phase=0;juce::String previous;int ticks=0;uint32_t noiseSeed=17;float lowNoise=0,deepNoise=0;
    bool richSignal=juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_RICH_SIGNAL",{})=="1";
    void timerCallback() override {
        for(int i=0;i<480;i++){
            float l=static_cast<float>(.08*std::sin(phase)),r=static_cast<float>(.04*std::sin(phase*.5));
            if(richSignal){noiseSeed=noiseSeed*1664525u+1013904223u;const float n=float(noiseSeed>>8)/8388608.f-1;lowNoise=.97f*lowNoise+.03f*n;deepNoise=.997f*deepNoise+.003f*n;
                const float bed=.008f*n+.08f*lowNoise+.25f*deepNoise;
                l=bed+float(.025*std::sin(phase*.125)+.015*std::sin(phase*.25)+.009*std::sin(phase)+.005*std::sin(phase*4));
                r=bed+float(.02*std::sin(phase*.167)+.012*std::sin(phase*.33)+.006*std::sin(phase*1.5));}
            buffer.setSample(0,i,l);buffer.setSample(1,i,r);phase+=juce::MathConstants<double>::twoPi*440/48000;
        }
        processor->processBlock(buffer,midi);
        ++ticks;
        if(workflow){
            try{workflow->run(*processor,*static_cast<juce::AudioProcessorEditor*>(window->getContentComponent()));if(workflow->done){quit();return;}if(ticks>6000)throw std::runtime_error("Editor workflow timed out at stage "+std::to_string(workflow->stage));}
            catch(const std::exception& error){std::cerr<<"UI_QA_FAILED: "<<error.what()<<std::endl;setApplicationReturnValue(1);quit();}return;
        }
        if(ticks==150&&juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_FORMAT_PREVIEW",{})=="1")if(auto* b=dynamic_cast<juce::Button*>(window->getContentComponent()->findChildWithID("session-setup")))b->triggerClick();
        if(ticks==200){
            const auto path=juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_SNAPSHOT",{});
            if(path.isNotEmpty()){
                auto image=window->getContentComponent()->createComponentSnapshot(window->getContentComponent()->getLocalBounds(),true,juce::jlimit(1.0f,4.0f,juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_SNAPSHOT_SCALE","2").getFloatValue()));
                juce::File file(path);auto output=file.createOutputStream();
                if(output){output->setPosition(0);output->truncate();juce::PNGImageFormat format;format.writeImageToStream(image,*output);output->flush();std::cout<<"SNAPSHOT_SAVED"<<std::endl;}
            }
        }
        const auto s=processor->controller->status();
        const auto state=s.message+" | protected="+juce::String(static_cast<int>(s.passcodeRequired))+" | warning="+juce::String(static_cast<int>(s.warning))+" | "+s.link;
        if(state!=previous){std::cout<<"STATE: "<<state<<std::endl;previous=state;}
    }
};
START_JUCE_APPLICATION(InvitePreview)
