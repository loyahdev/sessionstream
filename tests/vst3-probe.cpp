#include <juce_audio_utils/juce_audio_utils.h>
#include <chrono>
#include <thread>
#include <iostream>
#if JUCE_WINDOWS
#include <windows.h>
#include <conio.h>
#else
#include <poll.h>
#include <unistd.h>
#endif
static void readCommands(std::string& input){
   #if JUCE_WINDOWS
    const auto handle=GetStdHandle(STD_INPUT_HANDLE);
    if(GetFileType(handle)==FILE_TYPE_PIPE){
        DWORD available=0;
        if(PeekNamedPipe(handle,nullptr,0,nullptr,&available,nullptr)&&available){
            char buf[256];DWORD n=0;
            if(ReadFile(handle,buf,static_cast<DWORD>(std::min<size_t>(sizeof(buf),available)),&n,nullptr))input.append(buf,n);
        }
    }else if(GetFileType(handle)==FILE_TYPE_CHAR){
        while(_kbhit()){const auto c=_getch();input+=c=='\r'?'\n':static_cast<char>(c);}
    }
   #else
    struct pollfd fd{STDIN_FILENO,POLLIN,0};
    if(poll(&fd,1,0)>0&&(fd.revents&POLLIN)){char buf[256];const int n=static_cast<int>(read(STDIN_FILENO,buf,sizeof(buf)));if(n>0)input.append(buf,n);}
   #endif
}
int main(int argc,char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    if(argc<2){std::cerr<<"Usage: vst3-probe /path/to/plugin.vst3-or.component [stream-seconds]\n";return 1;}
    const bool audioUnit=juce::String(argv[1]).endsWith(".component");
    std::unique_ptr<juce::AudioPluginFormat> format;
   #if JUCE_PLUGINHOST_AU
    if(audioUnit)format=std::make_unique<juce::AudioUnitPluginFormat>();else
   #else
    if(audioUnit){std::cerr<<"Audio Units require macOS\n";return 1;}
   #endif
    format=std::make_unique<juce::VST3PluginFormat>();
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions,argv[1]);
    if(descriptions.size()!=1){std::cerr<<"Plugin discovery failed\n";return 2;}
    juce::String error;auto p=format->createInstanceFromDescription(*descriptions[0],48000,256,error);
    if(!p){std::cerr<<error<<"\n";return 3;}
    p->setPlayConfigDetails(2,2,48000,256);p->prepareToPlay(48000,256);
    auto params=p->getParameters();juce::AudioProcessorParameter* send=nullptr;juce::AudioProcessorParameter* gain=nullptr;juce::AudioProcessorParameter* bypass=p->getBypassParameter();
    for(auto* param:params){if(param->getName(64)=="Send audio")send=param;if(param->getName(64)=="Stream output dB")gain=param;if(param->getName(64)=="Bypass")bypass=param;}
    if(!send){std::cerr<<"Send audio parameter missing\n";return 4;}
    const int seconds=argc>2?std::atoi(argv[2]):0;
    send->setValueNotifyingHost(seconds>0?1.f:0.f);
    juce::AudioBuffer<float> b(2,256),original(2,256);juce::MidiBuffer midi;
    const auto start=std::chrono::steady_clock::now();uint64_t sample=0;std::string input;bool rendering=true,removed=false;
    for(int block=0;block<juce::jmax(1,seconds*48000/256);block++){
        readCommands(input);
        for(auto pos=input.find('\n');pos!=std::string::npos;pos=input.find('\n')){
            const auto line=input.substr(0,pos);input.erase(0,pos+1);
            std::cout<<"CONTROL: "<<line<<std::endl;
            if(line.rfind("send ",0)==0)send->setValueNotifyingHost(std::stof(line.substr(5)));
            if(gain&&line.rfind("gain ",0)==0)gain->setValueNotifyingHost((std::stof(line.substr(5))+60)/72);
            if(line.rfind("bypass ",0)==0){if(!bypass){std::cerr<<"Bypass parameter missing\n";return 6;}bypass->setValueNotifyingHost(std::stof(line.substr(7)));}
            if(line.rfind("suspend ",0)==0)rendering=std::stoi(line.substr(8))==0;
            if(line=="reset")p->reset();
            if(line=="deactivate"){p->releaseResources();rendering=false;}
            if(line=="activate"){p->prepareToPlay(48000,256);rendering=true;}
            if(line=="remove"){p.reset();removed=true;break;}
        }
        if(removed)break;
        for(int i=0;i<256;i++,sample++){
            b.setSample(0,i,.08f*std::sin(2*juce::MathConstants<double>::pi*440*sample/48000));
            b.setSample(1,i,.04f*std::sin(2*juce::MathConstants<double>::pi*880*sample/48000));
        }
        original.makeCopyOf(b);if(rendering)p->processBlock(b,midi);
        for(int ch=0;ch<2;ch++)for(int i=0;i<256;i++)if(b.getSample(ch,i)!=original.getSample(ch,i)){std::cerr<<"Passthrough changed\n";return 5;}
        if(seconds)std::this_thread::sleep_until(start+std::chrono::microseconds(sample*1000000/48000));
    }
    if(p)p->releaseResources();
    std::cout<<"PASS: actual "<<(audioUnit?"Audio Unit":"VST3")<<" discovered, loaded, stereo passthrough verified, Send audio automation available\n";
}
