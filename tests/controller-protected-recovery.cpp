#include "Controller.h"
#include <atomic>
#include <chrono>
#include <iostream>

template <typename Check>
bool waitFor(StreamController& controller, const char* label, Check check) {
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::seconds(12);
    while(std::chrono::steady_clock::now()<deadline){
        const auto status=controller.status();
        if(check(status))return true;
        juce::Thread::sleep(25);
    }
    const auto status=controller.status();
    std::cerr<<"Timed out: "<<label<<" | "<<status.message<<" | "<<status.link<<std::endl;
    return false;
}

static int queuedStart(const char* endpoint){
    std::atomic<bool> entered{false},released{false},firstRead{true},desired{false};
    StreamController controller(101,[&]{
        if(firstRead.exchange(false)){entered=true;while(!released.load())juce::Thread::sleep(1);}
        return desired.load();
    },endpoint,juce::File("/missing-test-runtime"));
    for(int i=0;i<3000&&!entered.load();++i)juce::Thread::sleep(1);
    if(!entered){released=true;return 20;}
    // Pause exactly after the control loop checked for a Generate request,
    // then queue a protected Start before it reads the desired audio state.
    controller.generate("protected-race-code");desired=true;released=true;controller.wake();
    if(!waitFor(controller,"queued protected Start",[](auto s){return s.live&&s.passcodeRequired&&!s.generating&&s.link.isNotEmpty();}))return 21;
    std::cout<<"PASS: queued Start generated its protected invite before enabling audio"<<std::endl;
    return 0;
}

int main(int argc, char** argv) {
    if(argc==3&&juce::String(argv[2])=="--queued-start")return queuedStart(argv[1]);
    if(argc!=2)return 1;
    std::atomic<bool> desired{false}, enabled{true};
    StreamController controller(101,[&]{return desired.load();},argv[1],juce::File("/missing-test-runtime"),[&]{return enabled.load();});
    controller.prepare();controller.generate("protected-recovery-code");
    if(!waitFor(controller,"first protected invite",[](auto status){return status.link.isNotEmpty()&&!status.generating&&status.passcodeRequired;}))return 2;
    const auto initialLink=controller.status().link;
    desired=true;controller.wake();
    if(!waitFor(controller,"initial stream",[](auto status){return status.live&&status.passcodeRequired;}))return 3;
    std::cout<<"INITIAL_LIVE"<<std::endl;
    if(!waitFor(controller,"protected engine recovery",[&](auto status){return status.live&&status.passcodeRequired&&!status.generating&&status.link.isNotEmpty()&&status.link!=initialLink;}))return 4;
    std::cout<<"PASS: engine restart retained the passcode"<<std::endl;
    const auto recoveredLink=controller.status().link;
    enabled=false;controller.wake();
    if(!waitFor(controller,"bypass",[](auto status){return !status.live&&status.link.isEmpty()&&status.message.startsWith("Disabled in DAW");}))return 5;
    juce::Thread::sleep(350);enabled=true;controller.wake();
    if(!waitFor(controller,"protected bypass recovery",[&](auto status){return status.live&&status.passcodeRequired&&!status.generating&&status.link.isNotEmpty()&&status.link!=recoveredLink;}))return 6;
    std::cout<<"PASS: bypass and re-enable retained the passcode"<<std::endl;
    const auto protectedLink=controller.status().link;
    desired=false;controller.wake();
    if(!waitFor(controller,"stop before changing protection",[](auto status){return !status.live&&!status.generating&&status.link.isNotEmpty();}))return 7;
    controller.generate();
    if(!waitFor(controller,"explicit unprotected invite",[&](auto status){return !status.generating&&!status.passcodeRequired&&status.link.isNotEmpty()&&status.link!=protectedLink;}))return 8;
    const auto unrestrictedLink=controller.status().link;
    desired=true;controller.wake();
    if(!waitFor(controller,"unprotected stream",[](auto status){return status.live&&!status.passcodeRequired;}))return 9;
    std::cout<<"UNPROTECTED_LIVE"<<std::endl;
    if(!waitFor(controller,"unprotected engine recovery",[&](auto status){return status.live&&!status.passcodeRequired&&status.link.isNotEmpty()&&status.link!=unrestrictedLink;}))return 10;
    std::cout<<"PASS: explicit unprotected Generate cleared the previous session passcode"<<std::endl;
    return 0;
}
