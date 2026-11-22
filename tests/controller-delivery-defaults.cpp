#include "Controller.h"
#include <iostream>
#include <chrono>
template<class Check> bool waitFor(Check check){const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(6);while(std::chrono::steady_clock::now()<end){if(check())return true;juce::Thread::sleep(25);}return false;}
int main(int argc,char** argv){
 if(argc!=4)return 1;const juce::String scenario=argv[2];const juce::File preferences(argv[3]);
 auto make=[&]{return std::make_unique<StreamController>(101,[]{return false;},argv[1],juce::File("/missing-test-runtime"),[]{return true;},std::function<void()>{},std::function<void()>{},preferences);};
 auto controller=make();
 if(scenario=="saved-cloud-free")controller->cloudDelivery(true);
 if(scenario=="restored-direct")controller->restoreCloudDelivery(false,true);
 controller->prepare();
 if(!waitFor([&]{return controller->status().planKnown&&controller->status().ready;}))return 2;
 if(scenario=="saved-cloud-free"){if(controller->usesCloud()||!controller->preferredCloudDelivery())return 3;}
 else if(scenario=="restored-direct"){if(controller->usesCloud()||!controller->hasDeliveryPreference())return 4;}
 else if(scenario=="saved-direct"){
  if(!controller->usesCloud())return 5;controller->chooseCloudDelivery(false);controller.reset();controller=make();controller->prepare();
  if(!waitFor([&]{return controller->status().planKnown&&controller->status().ready;}))return 6;
  if(controller->usesCloud()||!controller->hasDeliveryPreference())return 7;
 }else{
  if(!controller->usesCloud()||controller->hasDeliveryPreference()||!controller->encryptsAudio())return 8;
  if(scenario=="exhausted-pro"&&controller->status().canCloud)return 9;
 }
 if(scenario!="exhausted-pro"){
  controller->generate();
  if(!waitFor([&]{const auto s=controller->status();return s.hasSession&&!s.generating&&s.link.isNotEmpty();}))return 10;
 }
 std::cout<<"PASS: "<<scenario<<std::endl;
}
