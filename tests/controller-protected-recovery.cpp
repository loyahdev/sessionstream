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

int main(int argc, char** argv) {
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
