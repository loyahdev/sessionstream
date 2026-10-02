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
        p->controller=std::make_unique<StreamController>(p->transport.getSourceId(),[processor]{return processor->isSending();},argv[1],juce::File::getCurrentWorkingDirectory().getChildFile("missing-seek-test-runtime"),[processor]{return processor->isHostEnabled();});
        p->prepareToPlay(48000,256);
        p->controller->generate("seek-test-code");
        waitFor(*p,[](auto s){return !s.generating&&s.link.isNotEmpty()&&s.passcodeRequired;});
        p->setSending(true);
        waitFor(*p,[](auto s){return s.live&&s.passcodeRequired;});
        auto invite=p->controller->status().link;
        std::cout<<"READY"<<std::endl;
        std::string command;
        while(std::getline(std::cin,command)){
            if(command=="reset"||command=="reconfigure"){
                if(command=="reconfigure"){
                    p->releaseResources();
                    juce::Thread::sleep(100);
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
            }else if(command=="deactivate"){
                p->releaseResources();
                waitFor(*p,[](auto s){return !s.live&&s.link.isEmpty()&&s.message.startsWith("Disabled in DAW");});
                std::cout<<"DEACTIVATED"<<std::endl;
            }else if(command=="activate"){
                p->prepareToPlay(48000,256);
                p->controller->wake();
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
