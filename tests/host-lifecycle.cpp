#include "Processor.h"
#include "Diagnostics.h"
#include <iostream>
#include <stdexcept>

static void require(bool condition,const char* message){if(!condition)throw std::runtime_error(message);}
int main(){
    juce::ScopedJuceInitialiser_GUI init;
    try {
        HostActivity concurrent;concurrent.prepare();std::atomic<bool> finish{false};
        std::thread render([&]{while(!finish.load())concurrent.block(false);});
        bool falselyDisabled=false;
        for(int i=0;i<1000000;i++)if(!concurrent.enabled()){falselyDisabled=true;break;}
        finish=true;render.join();require(!falselyDisabled,"Concurrent active callbacks were falsely classified as disabled");
        StreamProcessor p([]{return juce::String{};});
        const auto diagnostic=juce::JSON::parse(p.diagnostics());
        require(diagnostic["version"].toString()==UpdateChecker::currentVersion,"Diagnostic version mismatch");
        require(diagnostic["os"].toString().isNotEmpty()&&diagnostic["pluginArchitecture"].toString().isNotEmpty(),"Diagnostic platform missing");
        require(!bool(diagnostic["hostEnabled"]),"Diagnostics must reflect inactive host");
        const auto* report=diagnostic.getDynamicObject();require(report&&report->hasProperty("runtimeLogs")&&report->hasProperty("controllerLogs")&&report->hasProperty("audioLifecycle"),"Diagnostic allowlist changed; review for private data");
        for(const auto* key:{"link","room","passcode","token","message","engineError"})require(!report->hasProperty(key),"Diagnostics contain private fields");
        const auto logDir=juce::File::getSpecialLocation(juce::File::tempDirectory).getNonexistentChildFile("sessionstream-log-export",{},false);
        logDir.createDirectory();
        logDir.getChildFile("engine.log").replaceWithText("engine failure details\n");
        logDir.getChildFile("engine.log.1").replaceWithText("previous run\n");
        logDir.getChildFile("launcher.log").replaceWithText("launcher details\n");
        logDir.getChildFile("public-url.json").replaceWithText("private invite must not be exported");
        const auto exported=sessionstream::runtimeLogs(logDir);logDir.deleteRecursively();
        require(exported.size()==3,"Diagnostics did not collect all retained logs");
        require(exported[0]["text"].toString().contains("launcher details")&&exported[1]["text"].toString().contains("previous run")&&exported[2]["text"].toString().contains("engine failure details"),"Log content or generation ordering was lost");
        require(!p.isHostEnabled(),"Unprepared processor must be inactive");
        p.reset();require(!p.isHostEnabled(),"Reset must not activate an unprepared processor");
        p.prepareToPlay(48000,256);
        require(p.isHostEnabled(),"Prepared processor should be enabled");
        juce::AudioBuffer<float> audio(2,256),original(2,256);juce::MidiBuffer midi;
        audio.clear();original.makeCopyOf(audio);
        p.processBlock(audio,midi);require(p.isHostEnabled(),"Silence must not count as bypass");
        auto* bypass=p.getBypassParameter();require(bypass,"Host bypass parameter missing");
        bypass->setValueNotifyingHost(1.f);require(!p.isHostEnabled(),"Host bypass must be observed without a render callback");
        p.reset();require(!p.isHostEnabled(),"Reset must not clear host bypass");
        p.processBlock(audio,midi);require(!p.transport.enabled.load(),"Bypassed processor must not transmit");
        bypass->setValueNotifyingHost(0.f);p.processBlock(audio,midi);require(p.isHostEnabled(),"Unbypass must restore activation");
        p.processBlockBypassed(audio,midi);require(!p.isHostEnabled(),"Legacy bypass callback must deactivate engine");
        for(int ch=0;ch<2;ch++)for(int i=0;i<256;i++)require(audio.getSample(ch,i)==original.getSample(ch,i),"Bypass changed DAW passthrough");
        p.processBlock(audio,midi);p.releaseResources();require(!p.isHostEnabled(),"Released audio must not transmit");require(p.shouldKeepSession(),"Audio release must preserve the session");
        p.prepareToPlay(48000,256);p.setSending(true);p.reset();
        require(p.isHostEnabled(),"setProcessing(false)/reset must preserve component activation");
        require(p.isSending(),"Seeking must preserve Send audio");
        juce::Thread::sleep(400);require(p.isHostEnabled(),"A processing pause after reset must preserve activation");
        p.processBlock(audio,midi);require(p.isHostEnabled(),"Rendering after reset must restore activation");
        p.setNonRealtime(true);p.processBlock(audio,midi);require(!p.isHostEnabled(),"Offline rendering must not keep tunnel online");
        require(p.shouldKeepSession(),"Offline rendering must preserve the engine lease");
        p.setNonRealtime(false);require(p.isHostEnabled(),"Leaving offline mode must not require another audio callback");p.processBlock(audio,midi);
        juce::Thread::sleep(2100);require(p.isHostEnabled(),"An enabled idle track must not be mistaken for a disabled plugin");
        p.processBlock(audio,midi);require(p.isHostEnabled(),"Rendering after idle must restore activation");
        std::cout<<"PASS: concurrent activation, host bypass, legacy bypass callback, deactivation, seek reset preservation, offline export recovery without a callback, silent blocks, idle-track preservation and reactivation\n";
    }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
    juce::Thread::sleep(250);
}
