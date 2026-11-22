#include "Controller.h"
#include <chrono>
#include <iostream>
template<class Check> bool waitFor(Check check){const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(7);while(std::chrono::steady_clock::now()<end){if(check())return true;juce::Thread::sleep(25);}return false;}
int main(int argc,char** argv){if(argc!=2)return 1;StreamController controller(101,[]{return false;},argv[1],juce::File("/missing-test-runtime"));controller.prepare();if(!waitFor([&]{return controller.status().ready;}))return 2;
 for(const auto& entry:std::vector<std::pair<int,juce::String>>{{1,"ready"},{2,"waiting"},{3,"cancelled"},{4,"idle"}}){controller.updatePlugin(entry.first);if(!waitFor([&]{return controller.status().updater["phase"].toString()==entry.second;}))return 3;}
 std::cout<<"PASS: native update download, install-on-close, cancel and dismiss controls"<<std::endl;
}
