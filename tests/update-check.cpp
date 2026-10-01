#include "UpdateChecker.h"
#include <iostream>
#include <stdexcept>
static void require(bool ok,const char* message){if(!ok)throw std::runtime_error(message);}
static UpdateChecker::Status wait(UpdateChecker& checker){for(int i=0;i<200;i++){auto s=checker.status();if(s.checked)return s;juce::Thread::sleep(50);}throw std::runtime_error("Update check timed out");}
int main(int argc,char** argv){
    try{
        require(!UpdateChecker::newer(UpdateChecker::currentVersion),"equal version");
        require(!UpdateChecker::newer(juce::String(UpdateChecker::currentVersion)+".0"),"trailing zero");
        require(UpdateChecker::newer("0.20","0.11"),"0.20 upgrades already-installed 0.11");
        require(!UpdateChecker::newer("0.20"),"current version does not offer itself");
        require(!UpdateChecker::newer("0.10")&&!UpdateChecker::newer("0.11"),"legacy versions cannot offer a downgrade");
        require(!UpdateChecker::newer("0.1"),"integer comparison");
        require(UpdateChecker::newer("0.21"),"minor update");
        require(UpdateChecker::newer(juce::String(UpdateChecker::currentVersion)+".1"),"patch update");
        require(UpdateChecker::newer("1.10","1.9"),"integer carry");
        require(UpdateChecker::newer(" v1.0\n"),"version prefix and whitespace");
        for(const auto* s:{"", "404: Not Found", "<html>0.11</html>","0..11","0.11-beta","0.11\n0.2","0.9999999999","0.11.0.0.1"})require(!UpdateChecker::newer(s),"reject invalid response");
        if(argc>1&&juce::String(argv[1])=="--live"){
            UpdateChecker live;const auto s=wait(live);require(s.latest.isNotEmpty(),"real version URL unavailable");
            std::cout<<"LIVE: current "<<UpdateChecker::currentVersion<<", remote "<<s.latest<<", update "<<s.available<<"\n";
        }
        {UpdateChecker failure([]{return juce::String("404: Not Found");});require(!wait(failure).available,"failed check must stay quiet");}
        {UpdateChecker same([]{return juce::String("0.20");});const auto s=wait(same);require(s.latest=="0.20"&&!s.available,"installed 0.20 stays current");}
        {UpdateChecker future([]{return juce::String("0.21");});require(wait(future).available,"future version should show prompt");future.ignoreForSession();require(!future.status().available,"ignore prompt");future.check();juce::Thread::sleep(350);require(!future.status().available,"recheck must not nag");}
        {UpdateChecker another([]{return juce::String("0.21");});require(!wait(another).available,"other instances should respect session ignore");}
        std::cout<<"PASS: dotted version comparison, malformed replies, background checks, update availability and session dismissal\n";
    }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
