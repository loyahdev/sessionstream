#pragma once
#include <juce_core/juce_core.h>
#include <dlfcn.h>
#include <atomic>
#include "WorkerThread.h"

class StreamController final : private WorkerThread {
public:
    struct Status { juce::String link,message="Generate an invite to get started.";int listeners=0;bool live=false,available=false,generating=false,passcodeRequired=false,warning=false; };
    explicit StreamController(uint32_t id,std::function<bool()> sending,juce::String endpoint="http://127.0.0.1:8788",juce::File resources={},std::function<bool()> enabled=[]{return true;})
        :WorkerThread("SessionStream control"),source(id),wantsAudio(std::move(sending)),hostEnabled(std::move(enabled)),base(std::move(endpoint)),runtimeOverride(std::move(resources)){startThread();}
    ~StreamController() override{stopThread();}
    void wake(){notify();}
    void prepare(){prepared=true;notify();}
    void generate(juce::String passcode={}){{const juce::ScopedLock l(lock);if(current.generating)return;pendingPasscode=std::move(passcode);current.generating=true;current.link.clear();current.warning=false;current.message="Creating your share link...";}generateRequested=true;prepared=true;notify();}
    Status status(){const juce::ScopedLock l(lock);return current;}
private:
    uint32_t source;std::function<bool()> wantsAudio,hostEnabled;juce::String base;juce::File runtimeOverride;
    std::atomic<bool> generateRequested{false},prepared{false};juce::CriticalSection lock;Status current;juce::String pendingPasscode;
    juce::ChildProcess child;juce::String token;bool owned=false,lifetimeSupported=false;uint32_t nextLaunch=0;
    juce::File runtime(){
        if(runtimeOverride.exists())return runtimeOverride;
        Dl_info info{};
        if(dladdr(reinterpret_cast<const void*>(&locateRuntime),&info)&&info.dli_fname){
            const auto f=juce::File(juce::String::fromUTF8(info.dli_fname)).getParentDirectory().getParentDirectory().getChildFile("Resources/runtime");
            if(f.getChildFile("bin/node").existsAsFile())return f;
        }
        return {};
    }
    static void locateRuntime(){}
    juce::var request(juce::String endpoint,juce::var body={}){
        juce::var result;
        sessionstream::withAutoreleasePool([&]{result=requestInsidePool(endpoint,body);});
        return result;
    }
    juce::var requestInsidePool(const juce::String& endpoint,const juce::var& body){
        juce::URL url(base+endpoint);int code=0;juce::String headers,method="GET";
        if(!body.isVoid()){url=url.withPOSTData(juce::JSON::toString(body));method="POST";headers="Content-Type: application/json\r\nOrigin: "+base+"\r\nAuthorization: Bearer "+token+"\r\n";}
        auto stream=url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs(1000).withStatusCode(&code).withHttpRequestCmd(method).withExtraHeaders(headers));
        return stream&&code==200?juce::JSON::parse(stream->readEntireStreamAsString()):juce::var();
    }
    bool action(const char* name,const juce::String& requestId={},const juce::String& passcode={}){
        auto* object=new juce::DynamicObject();object->setProperty("action",name);object->setProperty("source",static_cast<juce::int64>(source));
        if(requestId.isNotEmpty())object->setProperty("requestId",requestId);
        if(juce::String(name)=="generate")object->setProperty("passcode",passcode);
        return bool(request("/api/control",juce::var(object))["ok"]);
    }
    bool engine(const char* name){
        auto* object=new juce::DynamicObject();object->setProperty("action",name);object->setProperty("source",static_cast<juce::int64>(source));
        return bool(request("/api/engine",juce::var(object))["ok"]);
    }
    void detach(){
        if(token.isNotEmpty()){if(lifetimeSupported)engine("detach");else if(owned)action("stop");}
        token.clear();owned=false;lifetimeSupported=false;
    }
    bool launch(bool replaceLegacy=false){
        const auto now=juce::Time::getMillisecondCounter();
        if(child.isRunning()||(nextLaunch!=0&&static_cast<int32_t>(now-nextLaunch)<0))return false;
        const auto dir=runtime();nextLaunch=now+2000;
        if(!dir.exists())return false;
        juce::StringArray args{dir.getChildFile("bin/node").getFullPathName(),dir.getChildFile("scripts/launch-engine.mjs").getFullPathName()};
        if(replaceLegacy)args.add("--replace-legacy");
        return child.start(args,0);
    }
    void run() override{
        bool generating=false,acknowledged=false;int unavailableReads=0;juce::String requestId,requestPasscode,sessionPasscode;
        while(!threadShouldExit()){
            (void)child.isRunning(); // Reap the short-lived launcher, including while bypassed.
            if(!hostEnabled()){
                detach();prepared=false;generateRequested=false;generating=false;acknowledged=false;unavailableReads=0;nextLaunch=0;
                Status next;next.message="Disabled in DAW. Enable this plugin to share audio.";
                {const juce::ScopedLock l(lock);pendingPasscode.clear();current=next;}requestPasscode.clear();wait(250);continue;
            }
            if(generateRequested.exchange(false)&&!generating){generating=true;acknowledged=false;requestId=juce::Uuid().toString();const juce::ScopedLock l(lock);requestPasscode=pendingPasscode;pendingPasscode.clear();}
            const bool desired=wantsAudio();
            // Host automation can start audio without opening the editor.
            // Once used, keep its lease while enabled so Stop preserves the
            // invite; bypass/removal below still clears this prepared state.
            if(desired)prepared=true;
            if(!prepared&&!generating&&!desired){Status next;{const juce::ScopedLock l(lock);current=next;}wait(250);continue;}
            auto data=request("/api/studio");Status next;next.generating=generating;
            if(data.isObject()&&bool(data["native"])){
                unavailableReads=0;
                const auto newToken=data["token"].toString();
                if(newToken!=token)acknowledged=false; // A restarted engine must acknowledge this pending request again.
                token=newToken;next.available=true;
                lifetimeSupported=static_cast<int>(data["engineProtocol"])>=1;
                if(!lifetimeSupported||static_cast<int>(data["controlProtocol"])<3){
                    next.message=bool(data["live"])?"Stop the old SessionStream session to update its engine.":"Updating streaming engine...";
                    if(!bool(data["live"]))launch(true);
                    {const juce::ScopedLock l(lock);current=next;}wait(250);continue;
                }
                if(lifetimeSupported&&!engine("attach")){next.message="Reconnecting streaming engine...";{const juce::ScopedLock l(lock);current=next;}wait(250);continue;}
                owned=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                const auto owner=data["owner"];const bool mine=!owner.isVoid()&&static_cast<juce::int64>(owner)==source;
                const bool busy=!owner.isVoid()&&!mine;
                auto link=data["listenerURL"].toString();const bool modern=static_cast<int>(data["controlProtocol"])>=2;
                const bool online=link.startsWith("https://")&&(!modern||bool(data["publicSiteReady"]));
                if(busy)next.message="Another plugin is using this session.";
                else{
                    // Recover a protected session without silently opening an
                    // unprotected invite after a helper restart or host bypass.
                    // This code lives only in this processor's memory.
                    if(desired&&!owned&&!generating&&sessionPasscode.isNotEmpty()){
                        generating=true;acknowledged=false;requestId=juce::Uuid().toString();requestPasscode=sessionPasscode;
                    }
                    // A lost POST response is harmless: the same request ID is
                    // acknowledged by GET and repeated requests never rotate twice.
                    if(generating&&modern&&owned&&data["inviteRequest"].toString()==requestId)acknowledged=true;
                    if(generating&&online&&!acknowledged)acknowledged=action("generate",requestId,requestPasscode);
                    if(generating&&acknowledged){const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}
                    const bool ownsInvite=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                    const bool readyNow=link.startsWith("https://")&&(!modern||bool(data["publicSiteReady"]));
                    if(generating&&acknowledged&&ownsInvite&&readyNow&&(!modern||data["inviteRequest"].toString()==requestId)){generating=false;owned=true;sessionPasscode=requestPasscode;requestPasscode.clear();}
                    if(desired&&readyNow&&!generating&&!bool(data["live"])){if(action("start")){owned=true;const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}}
                    if(!desired&&ownsInvite&&bool(data["live"]))action("stop");
                    if(ownsInvite)action("lease");
                    if(readyNow&&ownsInvite&&!generating)next.link=link;
                    next.live=desired&&bool(data["live"])&&ownsInvite;next.listeners=static_cast<int>(data["listeners"]);
                    next.passcodeRequired=ownsInvite&&bool(data["passcodeRequired"]);
                    const auto phase=data["tunnelPhase"].toString();
                    next.message=!readyNow?(phase=="retrying"?"Retrying your connection...":phase=="verifying"?"Checking your share link...":"Preparing your worldwide connection..."):
                        generating?"Creating your share link...":next.live?"Streaming live | high-quality stereo":ownsInvite?"Ready. Copy your invite and start streaming.":"Generate an invite to get started.";
                    if(!data["engineError"].isVoid())next.message="Connection issue: "+data["engineError"].toString();
                    const auto issue=data["listenerIssue"].toString();
                    if(next.live&&issue.isNotEmpty()){next.warning=true;next.message=issue;}
                }
            }else if(prepared||generating||desired){
                ++unavailableReads;
                next.message=data.isObject()?"Close the old broadcaster bridge to enable plugin streaming.":"Starting streaming engine...";
                if(!data.isObject()&&unavailableReads>=3){
                    if(!runtime().exists())next.message="Streaming runtime missing. Reinstall this plugin.";
                    else launch();
                }
            }
            next.generating=generating;{const juce::ScopedLock l(lock);current=next;}wait(250);
        }
        detach();
    }
};
