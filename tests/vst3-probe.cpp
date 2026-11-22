#include <juce_audio_utils/juce_audio_utils.h>
#include <chrono>
#include <thread>
#include <iostream>
#if JUCE_MAC
#include <AudioToolbox/AudioToolbox.h>
#include <CoreFoundation/CoreFoundation.h>
#endif
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
    juce::String discovery=argv[1];
   #if JUCE_MAC
    if(audioUnit){
        // AU discovery by file still resolves the installed registry identity.
        // Register this exact bundle under a process-local QA identity instead.
        const auto path=juce::File(argv[1]).getFullPathName();
        auto url=CFURLCreateFromFileSystemRepresentation(nullptr,reinterpret_cast<const UInt8*>(path.toRawUTF8()),static_cast<CFIndex>(path.getNumBytesAsUTF8()),true);
        auto bundle=CFBundleCreate(nullptr,url);CFRelease(url);
        if(!bundle||!CFBundleLoadExecutable(bundle)){std::cerr<<"Unable to load exact AU bundle\n";return 9;}
        auto factory=reinterpret_cast<AudioComponentFactoryFunction>(CFBundleGetFunctionPointerForName(bundle,CFSTR("SessionStreamAUFactory")));
        AudioComponentDescription description{0x61756678,0x51616633,0x53736175,0,0};
        if(!factory||!AudioComponentRegister(&description,CFSTR("SessionStream QA"),65539,factory)){std::cerr<<"Exact AU registration failed\n";return 10;}
        // Keep the bundle loaded for the lifetime of its registered factory.
        discovery="AudioUnit:Effects/aufx,Qaf3,Ssau";
    }
   #endif
    juce::OwnedArray<juce::PluginDescription> descriptions;
    format->findAllTypesForFile(descriptions,discovery);
    if(descriptions.size()!=1){std::cerr<<"Plugin discovery failed\n";return 2;}
    juce::String error;auto p=format->createInstanceFromDescription(*descriptions[0],48000,256,error);
    if(!p){std::cerr<<error<<"\n";return 3;}
    const int channels=argc>3?std::atoi(argv[3]):2;if(channels!=1&&channels!=2&&channels!=6&&channels!=8)return 7;auto layout=p->getBusesLayout();layout.inputBuses.set(0,juce::AudioChannelSet::canonicalChannelSet(channels));layout.outputBuses.set(0,juce::AudioChannelSet::canonicalChannelSet(channels));if(!p->setBusesLayout(layout)){std::cerr<<"Requested channel layout is unavailable\n";return 8;}p->setPlayConfigDetails(channels,channels,48000,256);p->prepareToPlay(48000,256);
    auto params=p->getParameters();juce::AudioProcessorParameter* send=nullptr;juce::AudioProcessorParameter* gain=nullptr;juce::AudioProcessorParameter* bypass=p->getBypassParameter();
    for(auto* param:params){if(param->getName(64)=="Send audio")send=param;if(param->getName(64)=="Stream output dB")gain=param;if(param->getName(64)=="Bypass")bypass=param;}
    if(!send){std::cerr<<"Send audio parameter missing\n";return 4;}
    const int seconds=argc>2?std::atoi(argv[2]):0;
    send->setValueNotifyingHost(seconds>0?1.f:0.f);
    juce::AudioBuffer<float> b(channels,256),original(channels,256);juce::MidiBuffer midi;
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
            if(line.rfind("offline ",0)==0){p->releaseResources();p->setNonRealtime(std::stoi(line.substr(8))!=0);p->prepareToPlay(48000,256);}
            if(line=="deactivate"){p->releaseResources();rendering=false;}
            if(line=="activate"){p->prepareToPlay(48000,256);rendering=true;}
            if(line=="remove"){p.reset();removed=true;break;}
        }
        if(removed)break;
        for(int i=0;i<256;i++,sample++){
            for(int ch=0;ch<channels;ch++)b.setSample(ch,i,float(.04*(ch+1))*std::sin(2*juce::MathConstants<double>::pi*(220+ch*110)*sample/48000));
        }
        original.makeCopyOf(b);if(rendering)p->processBlock(b,midi);
        for(int ch=0;ch<channels;ch++)for(int i=0;i<256;i++)if(b.getSample(ch,i)!=original.getSample(ch,i)){std::cerr<<"Passthrough changed\n";return 5;}
        if(seconds)std::this_thread::sleep_until(start+std::chrono::microseconds(sample*1000000/48000));
    }
    if(p)p->releaseResources();
    std::cout<<"PASS: actual "<<(audioUnit?"Audio Unit":"VST3")<<" discovered, loaded, "<<channels<<"-channel passthrough verified, Send audio automation available\n";
}
