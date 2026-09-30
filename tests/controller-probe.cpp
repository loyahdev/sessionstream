#include "Controller.h"
#include <iostream>
#include <chrono>
int runProbe(int argc,char** argv){
    if(argc<3)return 1;
    const auto start=std::chrono::steady_clock::now();
    StreamController controller(101,[]{return false;},argv[2],juce::File(argv[1]));
    controller.prepare();juce::Thread::sleep(500);controller.generate();
    juce::String previous;
    for(int i=0;i<400;i++){
        const auto status=controller.status();if(status.message!=previous){std::cout<<status.message<<std::endl;previous=status.message;}
        if(status.link.startsWith("https://")&&!status.generating){
            const auto elapsed=std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count();
            std::cout<<"PASS: first Generate completed without editor/plugin reload in "<<elapsed<<" seconds\n";
            if(argc>3&&juce::String(argv[3])=="--verify-link"){
                std::cout<<"INVITE: "<<status.link<<std::endl;
                std::string verified;std::getline(std::cin,verified);
                if(verified!="verified")return 4;
            }
            const auto old=status.link;controller.generate();const auto warm=std::chrono::steady_clock::now();
            for(int j=0;j<40;j++){juce::Thread::sleep(100);const auto next=controller.status();if(!next.generating&&next.link.isNotEmpty()&&next.link!=old){std::cout<<"PASS: warm Generate in "<<std::chrono::duration<double>(std::chrono::steady_clock::now()-warm).count()<<" seconds\n";return 0;}}
            std::cerr<<"Warm Generate failed\n";return 3;
        }
        juce::Thread::sleep(250);
    }
    std::cerr<<"First Generate timed out\n";return 2;
}

int main(int argc,char** argv){
    const auto result=runProbe(argc,argv);
    // JUCE marks a thread stopped before its platform autorelease pool drains.
    // Keep process-global Objective-C classes alive through that final drain.
    juce::Thread::sleep(250);
    return result;
}
