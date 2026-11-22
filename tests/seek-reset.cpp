#include "Processor.h"
#include <chrono>
#include <iostream>
#include <stdexcept>

static void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
template <typename Check>
static void waitFor(StreamProcessor& p,Check check){
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(8);
    while(std::chrono::steady_clock::now()<deadline){
        if(check(p.controller->status()))return;
        juce::Thread::sleep(25);
    }
    const auto state=p.controller->status();
    std::cerr<<"Controller timeout: "<<state.message<<" | ready="<<state.ready<<" generating="<<state.generating<<" live="<<state.live<<" sending="<<p.isSending()<<std::endl;
    for(const auto& line:p.controller->logs())std::cerr<<line<<std::endl;
    throw std::runtime_error("Controller did not reach the expected lifecycle state");
}
int main(int argc,char** argv){
    if(argc!=2)return 1;
    juce::ScopedJuceInitialiser_GUI init;
    try{
        auto p=std::make_unique<StreamProcessor>([]{return juce::String{};});
        // Replace the unprepared controller with an isolated local endpoint.
        // This test never starts the installed helper or sends audio to its UDP port.
        p->controller.reset();
        auto* processor=p.get();
        p->controller=std::make_unique<StreamController>(p->transport.getSourceId(),[processor]{return processor->isSending();},argv[1],juce::File::getCurrentWorkingDirectory().getChildFile("missing-seek-test-runtime"),[processor]{return processor->shouldKeepSession();});
        // This integrity probe compares raw PCM bytes; encrypted playback is covered separately.
        p->controller->encryptAudio(false);
        std::unique_ptr<juce::AudioProcessorEditor> editor(p->createEditor());
        juce::TextButton* start=nullptr;juce::ToggleButton* protection=nullptr;juce::TextEditor* passcode=nullptr;
        bool sawGenerate=false;
        for(auto* child:editor->getChildren()){
            if(auto* button=dynamic_cast<juce::TextButton*>(child)){
                if(button->getComponentID()=="new-link"){sawGenerate=true;require(!button->isEnabled(),"Generate was enabled during loading");}
                if(button->getComponentID()=="stream-toggle"){start=button;require(!button->isEnabled(),"Start was enabled while loading");}
            }
            if(auto* toggle=dynamic_cast<juce::ToggleButton*>(child))protection=toggle;
            if(auto* text=dynamic_cast<juce::TextEditor*>(child))if(text->getPasswordCharacter()!=0)passcode=text;
        }
        require(sawGenerate&&start&&protection&&passcode,"Startup controls were not initialized");
        std::cout<<"LOADING_CONTROLS_OK"<<std::endl;
        p->prepareToPlay(48000,256);
        waitFor(*p,[](auto s){return s.ready&&!s.generating&&s.link.isEmpty();});
        std::cout<<"CONNECTION_READY"<<std::endl;
        juce::Thread::sleep(100);juce::Timer::callPendingTimersSynchronously();
        require(protection->isEnabled(),"Passcode control did not become ready");
        protection->setToggleState(true,juce::dontSendNotification);protection->onClick();passcode->setText("seek-test-code");
        juce::Thread::sleep(100);juce::Timer::callPendingTimersSynchronously();
        require(protection->getToggleState(),"Passcode checkbox lost its selected state");
        require(passcode->getText()=="seek-test-code","Passcode input lost its value");
        require(start->isEnabled(),"Start must be available before creating an invite");
        start->onClick();
        std::cout<<"START_CLICKED"<<std::endl;
        waitFor(*p,[](auto s){return s.live&&s.passcodeRequired&&!s.generating&&s.link.isNotEmpty();});
        require(p->isSending(),"One-click start did not enable streaming");
        const auto snapshot=juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_SNAPSHOT",{});
        if(snapshot.isNotEmpty()){
            juce::Thread::sleep(100);juce::Timer::callPendingTimersSynchronously();
            const auto image=editor->createComponentSnapshot(editor->getLocalBounds(),true,2.f);
            if(auto output=juce::File(snapshot).createOutputStream()){output->setPosition(0);output->truncate();juce::PNGImageFormat{}.writeImageToStream(image,*output);}
        }
        editor.reset();
        std::cout<<"ONE_CLICK_START_OK"<<std::endl;
        auto invite=p->controller->status().link;
        std::cout<<"READY"<<std::endl;
        std::string command;
        while(std::getline(std::cin,command)){
            if(command=="reset"||command=="reconfigure"){
                if(command=="reconfigure"){
                    p->releaseResources();
                    juce::Thread::sleep(6500);
                    p->prepareToPlay(48000,256);
                }else p->reset();
                // Leave rendering paused for several controller polls so an
                // accidental deactivation cannot hide behind a fast next callback.
                juce::Thread::sleep(800);
                require(p->isHostEnabled(),"Audio reset incorrectly deactivated the host");
                require(p->isSending(),"Audio reset cleared Send audio");
                const auto s=p->controller->status();
                require(s.live&&s.passcodeRequired&&s.link==invite,"Audio reset invalidated the protected invite");
                juce::AudioBuffer<float> audio(2,128);audio.clear();juce::MidiBuffer midi;
                p->processBlock(audio,midi);
                require(p->transport.enabled.load(),"Rendering did not resume after reset");
                std::cout<<(command=="reset"?"RESET_OK":"RECONFIGURE_OK")<<std::endl;
            }else if(command=="offline"){
                p->setNonRealtime(true);p->releaseResources();p->prepareToPlay(96000,8192);
                juce::MemoryBlock state;p->getStateInformation(state);p->setStateInformation(state.getData(),int(state.getSize()));
                juce::AudioBuffer<float> audio(2,8192),original(2,8192);juce::MidiBuffer midi;
                for(int ch=0;ch<2;++ch)for(int i=0;i<8192;++i)audio.setSample(ch,i,.25f*(ch?1:-1));
                original.makeCopyOf(audio);
                p->processBlock(audio,midi);p->reset();
                require(!p->transport.enabled.load(),"Offline render transmitted audio");
                for(int ch=0;ch<2;++ch)for(int i=0;i<8192;++i)require(audio.getSample(ch,i)==original.getSample(ch,i),"Offline render changed DAW audio");
                juce::Thread::sleep(6500);
                p->setNonRealtime(false);
                require(p->isHostEnabled(),"Offline exit latched a disabled state");
                require(p->isSending(),"Host state restore during rendering stopped the session");
                const auto diagnostics=p->diagnostics();const auto parsed=juce::JSON::parse(diagnostics);
                require(static_cast<juce::int64>(parsed["audioLifecycle"]["offlineBlocks"])>0,"Offline lifecycle missing from diagnostics");
                require(parsed["controllerLogs"].size()>0,"Controller logs missing from diagnostics");
                require(!diagnostics.contains("seek-test-code")&&!diagnostics.contains(invite),"Diagnostics leaked the passcode or invite");
                const auto s=p->controller->status();
                require(s.live&&s.link==invite&&s.passcodeRequired,"Offline render revoked the protected invite");
                p->prepareToPlay(48000,256);p->processBlock(audio,midi);
                require(p->transport.enabled.load(),"Realtime transmission did not resume");
                std::cout<<"OFFLINE_OK"<<std::endl;
            }else if(command=="deactivate"){
                p->releaseResources();juce::Thread::sleep(6500);
                const auto s=p->controller->status();
                require(s.live&&s.link==invite&&s.passcodeRequired,"Released audio revoked the session");
                std::cout<<"AUDIO_RELEASED"<<std::endl;
            }else if(command=="activate"){
                p->prepareToPlay(48000,256);
                require(p->controller->status().link==invite,"Audio reactivation rotated the invite");
                std::cout<<"AUDIO_RESTORED"<<std::endl;
            }else if(command=="bypass"){
                p->getBypassParameter()->setValueNotifyingHost(1.f);p->controller->wake();
                waitFor(*p,[](auto s){return !s.live&&s.link.isEmpty()&&s.message.startsWith("Disabled in DAW");});
                std::cout<<"DEACTIVATED"<<std::endl;
            }else if(command=="unbypass"){
                p->getBypassParameter()->setValueNotifyingHost(0.f);p->controller->wake();
                waitFor(*p,[](auto s){return s.live&&s.passcodeRequired&&s.link.isNotEmpty();});
                require(p->controller->status().link!=invite,"Reactivation did not create a fresh invite");
                invite=p->controller->status().link;
                std::cout<<"REACTIVATED"<<std::endl;
            }else if(command=="remove"){
                p.reset();
                std::cout<<"REMOVED"<<std::endl;
                juce::Thread::sleep(250);
                return 0;
            }else throw std::runtime_error("Unknown lifecycle test command");
        }
        throw std::runtime_error("Test ended before plugin removal");
    }catch(const std::exception& e){std::cerr<<e.what()<<std::endl;return 1;}
}
