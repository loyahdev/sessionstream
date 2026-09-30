#pragma once
#include <juce_core/juce_core.h>
#include <dlfcn.h>
#include <atomic>

class StreamController final : private juce::Thread {
public:
    struct Status { juce::String link,message="Generate an invite to get started.";int listeners=0;bool live=false,available=false,generating=false; };
    explicit StreamController(uint32_t id,std::function<bool()> sending,juce::String endpoint="http://127.0.0.1:8788",juce::File resources={})
        :Thread("SessionStream control"),source(id),wantsAudio(std::move(sending)),base(std::move(endpoint)),runtimeOverride(std::move(resources)){startThread();}
    ~StreamController() override{stopThread(4500);}
    void wake(){notify();}
    void prepare(){prepared=true;notify();}
    void generate(){generateRequested=true;prepared=true;{const juce::ScopedLock l(lock);current.generating=true;current.link.clear();current.message="Creating your share link...";}notify();}
    Status status(){const juce::ScopedLock l(lock);return current;}
private:
    uint32_t source;std::function<bool()> wantsAudio;juce::String base;juce::File runtimeOverride;
    std::atomic<bool> generateRequested{false},prepared{false};juce::CriticalSection lock;Status current;
    juce::ChildProcess child;juce::String token;bool owned=false;uint32_t nextLaunch=0;
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
        juce::URL url(base+endpoint);int code=0;juce::String headers,method="GET";
        if(!body.isVoid()){url=url.withPOSTData(juce::JSON::toString(body));method="POST";headers="Content-Type: application/json\r\nOrigin: "+base+"\r\nAuthorization: Bearer "+token+"\r\n";}
        auto stream=url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs(1000).withStatusCode(&code).withHttpRequestCmd(method).withExtraHeaders(headers));
        return stream&&code==200?juce::JSON::parse(stream->readEntireStreamAsString()):juce::var();
    }
    bool action(const char* name,const juce::String& requestId={}){
        auto* object=new juce::DynamicObject();object->setProperty("action",name);object->setProperty("source",static_cast<juce::int64>(source));
        if(requestId.isNotEmpty())object->setProperty("requestId",requestId);
        return bool(request("/api/control",juce::var(object))["ok"]);
    }
    void run() override{
        bool generating=false,acknowledged=false;int unavailableReads=0;juce::String requestId;
        while(!threadShouldExit()){
            if(generateRequested.exchange(false)&&!generating){generating=true;acknowledged=false;requestId=juce::Uuid().toString();}
            const bool desired=wantsAudio();auto data=request("/api/studio");Status next;next.generating=generating;
            if(data.isObject()&&bool(data["native"])){
                unavailableReads=0;
                const auto newToken=data["token"].toString();
                if(newToken!=token)acknowledged=false; // A restarted engine must acknowledge this pending request again.
                token=newToken;next.available=true;
                owned=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                const auto owner=data["owner"];const bool mine=!owner.isVoid()&&static_cast<juce::int64>(owner)==source;
                const bool busy=!owner.isVoid()&&!mine;
                auto link=data["listenerURL"].toString();const bool modern=static_cast<int>(data["controlProtocol"])>=2;
                const bool online=link.startsWith("https://")&&(!modern||bool(data["publicSiteReady"]));
                if(busy)next.message="Another plugin is using this session.";
                else{
                    // A lost POST response is harmless: the same request ID is
                    // acknowledged by GET and repeated requests never rotate twice.
                    if(generating&&modern&&owned&&data["inviteRequest"].toString()==requestId)acknowledged=true;
                    if(generating&&online&&!acknowledged)acknowledged=action("generate",requestId);
                    if(generating&&acknowledged){const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}
                    const bool ownsInvite=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                    const bool readyNow=link.startsWith("https://")&&(!modern||bool(data["publicSiteReady"]));
                    if(generating&&acknowledged&&ownsInvite&&readyNow&&(!modern||data["inviteRequest"].toString()==requestId)){generating=false;owned=true;}
                    if(desired&&readyNow&&!generating&&!bool(data["live"])){if(action("start")){owned=true;const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}}
                    if(!desired&&ownsInvite&&bool(data["live"]))action("stop");
                    if(ownsInvite)action("lease");
                    if(readyNow&&ownsInvite&&!generating)next.link=link;
                    next.live=desired&&bool(data["live"])&&ownsInvite;next.listeners=static_cast<int>(data["listeners"]);
                    const auto phase=data["tunnelPhase"].toString();
                    next.message=!readyNow?(phase=="retrying"?"Retrying your connection...":phase=="verifying"?"Checking your share link...":"Preparing your worldwide connection..."):
                        generating?"Creating your share link...":next.live?"Streaming live | high-quality stereo":ownsInvite?"Ready. Copy your invite and start streaming.":"Generate an invite to get started.";
                    if(!data["engineError"].isVoid())next.message="Connection issue: "+data["engineError"].toString();
                }
            }else if(prepared||generating||desired){
                ++unavailableReads;
                next.message=data.isObject()?"Close the old broadcaster bridge to enable plugin streaming.":"Starting streaming engine...";
                const auto now=juce::Time::getMillisecondCounter();
                if(!data.isObject()&&unavailableReads>=3&&!child.isRunning()&&(nextLaunch==0||static_cast<int32_t>(now-nextLaunch)>=0)){
                    const auto dir=runtime();nextLaunch=now+2000;
                    if(dir.exists()){if(!child.start(juce::StringArray{dir.getChildFile("bin/node").getFullPathName(),"--expose-gc",dir.getChildFile("scripts/companion.mjs").getFullPathName()},0))next.message="Could not start streaming engine. Retrying...";}
                    else next.message="Streaming runtime missing. Reinstall this plugin.";
                }
            }
            next.generating=generating;{const juce::ScopedLock l(lock);current=next;}wait(250);
        }
        if(owned)action("stop");
    }
};
