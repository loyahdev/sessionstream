#pragma once
#include <juce_core/juce_core.h>
#if JUCE_WINDOWS
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>
#else
#include <dlfcn.h>
#include <unistd.h>
#endif
#include <atomic>
#include "WorkerThread.h"
#include "StreamFormat.h"

class StreamController final : private WorkerThread {
public:
    struct Status { bool hasSession=false,ending=false,inviteExpired=false,activeElsewhere=false,handoffReady=false;juce::int64 streamStartedAt=0;juce::var transportDiagnostics,listenerAccess,updater;juce::String plan="free",listenerMessage;int listenerLimit=3,receiveChannels=2,streamChannels=2,streamQuality=1;bool canManageListeners=false,planKnown=false,canCloud=false;double cloudHoursRemaining=0;juce::String delivery="direct";bool encrypted=true;juce::String listenerSettingsAck; juce::String customName,linkMode,linkMessage;bool linkBusy=false,linkAuthorized=false;juce::String receivePhase,receiveMessage,receiveTransport="pcm";bool receiving=false;juce::String accountName,accountPhase,accountMessage;bool accountConfigured=false,reconnectRequired=false;juce::String link,message="Preparing streaming engine...";int listeners=0;bool live=false,available=false,ready=false,generating=false,passcodeRequired=false,warning=false; };
    explicit StreamController(uint32_t id,std::function<bool()> sending,juce::String endpoint="http://127.0.0.1:8788",juce::File resources={},std::function<bool()> enabled=[]{return true;},std::function<void()> expired={},std::function<void()> yielded={},juce::File preferences={})
        :WorkerThread("SessionStream control"),source(id),wantsAudio(std::move(sending)),hostEnabled(std::move(enabled)),onExpired(std::move(expired)),onYielded(std::move(yielded)),base(std::move(endpoint)),runtimeOverride(std::move(resources)),deliveryPrefs(preferences==juce::File{}?deliveryPreferenceFile():preferences){loadDeliveryPreference();startThread();}
    ~StreamController() override{stopThread();}
    void cloudDelivery(bool value){deliveryChoice.store(value?1:0);useCloud.store(value);}
    void restoreCloudDelivery(bool value,bool chosen){deliveryChoice.store(chosen?(value?1:0):-1);useCloud.store(value);}
    bool hasDeliveryPreference()const{return deliveryChoice.load()>=0;}
    bool preferredCloudDelivery()const{return deliveryChoice.load()==1;}
    void chooseCloudDelivery(bool value){cloudDelivery(value);const auto file=deliveryPrefs;file.getParentDirectory().createDirectory();auto saved=juce::JSON::parse(file);if(!saved.isObject())saved=juce::var(new juce::DynamicObject());saved.getDynamicObject()->setProperty("delivery",value?"cloud":"direct");file.replaceWithText(juce::JSON::toString(saved));}

    void inputLayout(int channels){inputChannels.store(channels);}
    int audioChannels(int fallback)const{const auto value=ownedChannels.load();return value>0?value:fallback;}
    bool hasProAudio()const{return proAudio.load();}
    bool usesCloud()const{return useCloud.load();}
    void encryptAudio(bool value){extraEncryption.store(value);}
    bool encryptsAudio()const{return extraEncryption.load();}
    void sessionSettings(int quality,int hours,int channels=2){sessionQuality.store(quality);sessionHours.store(hours);sessionChannels.store(channels);}
    void shareHostName(bool enabled){showHostName=enabled;}
    bool sharesHostName()const{return showHostName.load();}
    int listenerPreferences()const{return listenerPreferenceBits.load();}
    void restoreListenerPreferences(int bits){listenerPreferenceBits.store(bits&7);}
    void requirePasscode(bool enabled){passcodePreference.store(enabled);}
    bool requiresPasscode()const{return passcodePreference.load();}
    void preferCustomLink(bool enabled){customLinkPreference.store(enabled);}
    bool prefersCustomLink()const{return customLinkPreference.load();}
    void updatePlugin(int action){updateRequested.store(action);prepared=true;notify();}
    void wake(){notify();}
    void prepare(){prepared=true;notify();}
    void generate(juce::String passcode={},int quality=1,int hours=0){{const juce::ScopedLock l(lock);if(current.generating||generateRequested.load())return;memoryPasscode=passcode;pendingPasscode=std::move(passcode);sessionQuality.store(quality);sessionHours.store(hours);generateRequested=true;current.generating=true;current.link.clear();current.warning=false;current.message="Creating link...";}prepared=true;notify();}
    void endSession(){const juce::ScopedLock l(lock);endRequested=true;generateRequested=false;handoffRequested=false;current.ending=true;current.link.clear();current.ready=false;pendingPasscode.clear();memoryPasscode.clear();prepared=true;notify();}
    void handoff(){handoffRequested=true;prepared=true;notify();}
    juce::String activePasscode()const{const juce::ScopedLock l(lock);return memoryPasscode;}
    void manageListeners(juce::var command){const juce::ScopedLock l(lock);listenerCommands.add(command);prepared=true;notify();}
    void reconnectAccount(){accountRequested=3;prepared=true;notify();}
    void account(bool signIn){if(!signIn){const juce::ScopedLock l(lock);memoryPasscode.clear();}accountRequested=signIn?1:2;prepared=true;notify();}
    void receive(bool start,juce::String target,juce::String passcode,int port,bool lowLatency=false){
        const juce::ScopedLock l(lock);receiveDesired=start;receiveTarget=std::move(target);receivePasscode=std::move(passcode);receivePort=port;receiveLowLatency=lowLatency;++receiveRevision;prepared=true;notify();
    }
    void links(const juce::String& action,const juce::String& value={}){const juce::ScopedLock l(lock);linkAction=action;linkValue=value;current.linkBusy=true;current.linkMessage.clear();prepared=true;notify();}
    Status status(){const juce::ScopedLock l(lock);return current;}
    juce::StringArray logs(){const juce::ScopedLock l(lock);return events;}
private:
    static juce::int64 hostProcessId(){
#if JUCE_WINDOWS
        return static_cast<juce::int64>(GetCurrentProcessId());
#else
        return static_cast<juce::int64>(getpid());
#endif
    }
    uint32_t source;std::function<bool()> wantsAudio,hostEnabled;std::function<void()> onExpired,onYielded;juce::String base;juce::File runtimeOverride,deliveryPrefs;
    std::atomic<int> updateRequested{0},accountRequested{0},sessionQuality{1},sessionHours{0},sessionChannels{2},inputChannels{2},ownedChannels{0};
    std::atomic<bool> showHostName{false},passcodePreference{false},customLinkPreference{false};
    std::atomic<int> listenerPreferenceBits{0};
    std::atomic<bool> generateRequested{false},endRequested{false},handoffRequested{false},prepared{false};juce::CriticalSection lock;Status current;juce::String linkAction,linkValue,lastLinkAuthorization,receiveError;juce::String pendingPasscode,memoryPasscode,receiveTarget,receivePasscode;bool receiveDesired=false,receiveLowLatency=false;int receivePort=0;uint64_t receiveRevision=0;
    juce::ChildProcess child;juce::String token;bool owned=false,lifetimeSupported=false;uint32_t nextLaunch=0;
    std::atomic<bool> proAudio{false},useCloud{false},extraEncryption{true};
    std::atomic<int> deliveryChoice{-1};
    static juce::File deliveryPreferenceFile(){return juce::File::getSpecialLocation(juce::File::userApplicationDataDirectory).getChildFile("SessionStream").getChildFile("plugin-preferences.json");}
    void loadDeliveryPreference(){const auto saved=juce::JSON::parse(deliveryPrefs)["delivery"].toString();if(saved=="cloud"||saved=="direct")cloudDelivery(saved=="cloud");}

    juce::StringArray events;juce::Array<juce::var> listenerCommands;juce::String listenerError,listenerSettingsAck,controlError;
    void log(const juce::String& event){const juce::ScopedLock l(lock);events.add(juce::Time::getCurrentTime().toISO8601(true)+" "+event);while(events.size()>256)events.remove(0);}
    void publish(Status next){
        const juce::ScopedLock l(lock);
        // A UI request can arrive while an HTTP poll is in flight. Never let
        // that older poll re-enable Generate or expose the previous invite.
        if(endRequested.load()){next.ending=true;next.live=false;next.ready=false;next.link.clear();}
        if(generateRequested.load()){next.generating=true;next.link.clear();}
        if(next.available!=current.available||next.ready!=current.ready||next.generating!=current.generating||next.live!=current.live)
            log("controller available="+juce::String(int(next.available))+" ready="+juce::String(int(next.ready))+" generating="+juce::String(int(next.generating))+" live="+juce::String(int(next.live)));
        current=std::move(next);
    }
    static const char* nodeName(){
       #if JUCE_WINDOWS
        return "bin/node.exe";
       #else
        return "bin/node";
       #endif
    }
    juce::File runtime(){
        if(runtimeOverride.exists())return runtimeOverride;
       #if JUCE_WINDOWS
        // JUCE returns this module (the VST3 DLL), rather than the DAW EXE.
        const auto module=juce::File::getSpecialLocation(juce::File::currentExecutableFile);
        for(const auto& parent:{module.getParentDirectory().getParentDirectory(),module.getParentDirectory()}){
            const auto dir=parent.getChildFile("Resources/runtime");
            if(dir.getChildFile(nodeName()).existsAsFile())return dir;
        }
       #else
        Dl_info info{};
        if(dladdr(reinterpret_cast<const void*>(&locateRuntime),&info)&&info.dli_fname){
            const auto f=juce::File(juce::String::fromUTF8(info.dli_fname)).getParentDirectory().getParentDirectory().getChildFile("Resources/runtime");
            if(f.getChildFile(nodeName()).existsAsFile())return f;
        }
       #endif
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
        auto stream=url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs(endpoint=="/api/control"?40000:endpoint=="/api/listeners"?10000:1000).withStatusCode(&code).withHttpRequestCmd(method).withExtraHeaders(headers));
        if(!stream||code!=200)log(method+" "+endpoint+" failed: HTTP "+juce::String(code));
        return stream&&(code==200||endpoint=="/api/listeners"||endpoint=="/api/control")?juce::JSON::parse(stream->readEntireStreamAsString()):juce::var();
    }
    bool action(const char* name,const juce::String& requestId={},const juce::String& passcode={},bool pro=false){
        if(juce::String(name)!="lease")log("control "+juce::String(name));
        auto* object=new juce::DynamicObject();object->setProperty("action",name);object->setProperty("source",static_cast<juce::int64>(source));
        if(requestId.isNotEmpty())object->setProperty("requestId",requestId);
        const juce::String command(name);if(command=="generate"||command=="start"||command=="handoff")object->setProperty("inputChannels",inputChannels.load());
        if(command=="generate"||command=="start"){
            const auto access=pro?listenerPreferences():0;
            object->setProperty("listenerApproval",(access&1)!=0);
            object->setProperty("listenerAccounts",(access&2)!=0);
            object->setProperty("listenerFeedback",(access&4)!=0);
            object->setProperty("showHostName",sharesHostName());
            object->setProperty("linkType",pro&&prefersCustomLink()?"custom":"random");
        }
        if(command=="generate"){
            object->setProperty("delivery",usesCloud()?"cloud":"direct");
            object->setProperty("encrypted",encryptsAudio());
            object->setProperty("passcode",passcode);
            const auto quality=pro?sessionQuality.load():1;
            object->setProperty("quality",streamformat::ids[juce::jlimit(0,8,quality)]);object->setProperty("channels",pro?sessionChannels.load():2);
            object->setProperty("expiresInHours",sessionHours.load());
        }
        const auto result=request("/api/control",juce::var(object));const bool ok=bool(result["ok"]);if(command=="generate"||command=="start"||command=="handoff"){controlError=ok?juce::String{}:result["error"].toString();if(!ok&&controlError.isEmpty())controlError="Could not connect. Try starting the session again.";}return ok;
    }
    bool engine(const char* name){
        auto* object=new juce::DynamicObject();object->setProperty("action",name);object->setProperty("source",static_cast<juce::int64>(source));
        return bool(request("/api/engine",juce::var(object))["ok"]);
    }
    void detach(){
        if(token.isNotEmpty())log("session detached (bypass or removal)");
        if(token.isNotEmpty()){if(lifetimeSupported)engine("detach");else if(owned)action("stop");}
        ownedChannels.store(0);token.clear();owned=false;lifetimeSupported=false;
    }
    bool launch(bool replaceLegacy=false){
        const auto now=juce::Time::getMillisecondCounter();
        if(child.isRunning()||(nextLaunch!=0&&static_cast<int32_t>(now-nextLaunch)<0))return false;
        const auto dir=runtime();nextLaunch=now+2000;
        if(!dir.exists())return false;
        juce::StringArray args{dir.getChildFile(nodeName()).getFullPathName(),dir.getChildFile("scripts/launch-engine.mjs").getFullPathName()};
        if(replaceLegacy)args.add("--replace-legacy");
        const bool started=child.start(args,0);log(started?"engine launcher started":"engine launcher failed");return started;
    }
    void run() override{
        bool ending=false,generating=false,acknowledged=false,disabling=false;uint32_t disabledSince=0;int unavailableReads=0;juce::String requestId,requestPasscode,sessionPasscode;uint64_t appliedReceive=0;
        while(!threadShouldExit()){
            (void)child.isRunning(); // Reap the short-lived launcher, including while bypassed.
            if(!hostEnabled()){
                // This callback represents explicit device bypass only. Audio
                // release, suspension and offline rendering keep the lease.
                const auto now=juce::Time::getMillisecondCounter();
                if(!disabling){disabling=true;disabledSince=now;}
                if(token.isNotEmpty()&&now-disabledSince<500){wait(25);continue;}
                detach();prepared=false;generateRequested=false;generating=false;acknowledged=false;unavailableReads=0;nextLaunch=0;
                Status next;next.message="Disabled in DAW. Enable this plugin to share audio.";
                {const juce::ScopedLock l(lock);pendingPasscode.clear();}publish(next);requestPasscode.clear();wait(250);continue;
            }
            disabling=false;
            if(endRequested.exchange(false)){ending=true;generating=false;acknowledged=false;generateRequested=false;requestId.clear();requestPasscode.clear();sessionPasscode.clear();}
            if(generateRequested.exchange(false)&&!generating){generating=true;acknowledged=false;requestId=juce::Uuid().toString();const juce::ScopedLock l(lock);requestPasscode=pendingPasscode;pendingPasscode.clear();}
            const bool desired=wantsAudio();
            // Host automation can start audio without opening the editor.
            // Once used, keep its lease while enabled so Stop preserves the
            // invite; bypass/removal below still clears this prepared state.
            if(desired)prepared=true;
            if(!prepared&&!generating&&!desired){publish(Status{});wait(250);continue;}
            auto data=request("/api/studio");Status next;next.generating=generating;next.ending=ending;
            if(data.isObject()&&bool(data["native"])){
                unavailableReads=0;
                const auto newToken=data["token"].toString();
                if(newToken!=token){appliedReceive=0;log("engine identity changed");acknowledged=false;} // A restarted engine must acknowledge this pending request again.
                token=newToken;next.available=true;
                next.delivery=data["delivery"].toString()=="cloud"?"cloud":"direct";next.encrypted=bool(data["encrypted"]);next.canManageListeners=data["inviteSource"].isVoid()||static_cast<juce::int64>(data["inviteSource"])==source;next.listenerAccess=data["listenerAccess"];next.plan=data["accountConnection"]["plan"].toString();next.listenerLimit=int(data["accountConnection"]["listeners"]);next.planKnown=bool(data["accountConnection"]["planKnown"]);next.canCloud=bool(data["accountConnection"]["cloud"]["canCloud"]);next.cloudHoursRemaining=double(data["accountConnection"]["cloud"]["usage"]["remainingSeconds"])/3600.0;
                juce::Array<juce::var> commands;{const juce::ScopedLock l(lock);commands.swapWith(listenerCommands);}
                for(auto command:commands){
                    command.getDynamicObject()->setProperty("source",static_cast<juce::int64>(source));
                    const auto result=request("/api/listeners",command);
                    listenerError=result["error"].toString();
                    if(result.isVoid())listenerError="Could not update listener access. Try again.";
                    if(bool(result["ok"]))next.listenerAccess=result;
                    if(command["action"].toString()=="settings"){
                        listenerSettingsAck=command["requestId"].toString();
                        if(bool(result["ok"]))restoreListenerPreferences((bool(result["approval"])?1:0)|(bool(result["requireAccount"])?2:0)|(bool(result["feedback"])?4:0));
                    }
                }
                next.listenerSettingsAck=listenerSettingsAck;
                next.listenerMessage=listenerError;
                proAudio.store(next.planKnown&&next.plan=="pro"&&data["account"]["phase"].toString()=="signed-in");
                next.updater=data["updater"];
                if(const int update=updateRequested.exchange(0)){
                    auto* command=new juce::DynamicObject();command->setProperty("action",update==1?"download":update==2?"install":update==3?"cancel":"dismiss");
                    if(update==2)command->setProperty("hostPID",hostProcessId());
                    const auto result=request("/api/update",juce::var(command));if(result["error"].toString().isNotEmpty()){auto* failure=new juce::DynamicObject();failure->setProperty("phase","error");failure->setProperty("message",result["error"].toString());next.updater=juce::var(failure);}
                }
                next.accountName=data["account"]["name"].toString();next.accountPhase=data["account"]["phase"].toString();
                next.reconnectRequired=bool(data["accountConnection"]["reconnectRequired"]);next.accountMessage=data["accountConnection"]["message"].toString();if(next.accountMessage.isEmpty())next.accountMessage=data["account"]["message"].toString();next.accountConfigured=bool(data["account"]["configured"]);
                if(const int intent=accountRequested.exchange(0)){
                    auto* command=new juce::DynamicObject();command->setProperty("action",intent==1?"sign-in":intent==3?"reconnect":"sign-out");
                    const auto result=request("/api/account",juce::var(command));
                    const auto target=result["url"].toString();
                    if((intent==1||intent==3)&&target.startsWith("https://"))juce::URL(target).launchInDefaultBrowser();
                }
                next.customName=data["links"]["name"].toString();next.linkMode=data["links"]["mode"].toString();next.linkMessage=data["links"]["error"].toString();next.linkBusy=bool(data["links"]["busy"]);next.linkAuthorized=bool(data["links"]["authorized"]);
                juce::String pendingLinkAction,pendingLinkValue;{const juce::ScopedLock l(lock);pendingLinkAction=linkAction;pendingLinkValue=linkValue;linkAction.clear();linkValue.clear();}
                if(pendingLinkAction.isNotEmpty()){
                    auto* command=new juce::DynamicObject();command->setProperty("action",pendingLinkAction);command->setProperty("value",pendingLinkValue);command->setProperty("source",static_cast<juce::int64>(source));const auto result=request("/api/links",juce::var(command));next.linkBusy=bool(result["ok"]);if(pendingLinkAction=="release"&&next.linkBusy)preferCustomLink(false);if(result["error"].toString().isNotEmpty())next.linkMessage=result["error"].toString();
                }
                const auto authorization=data["links"]["authorizationURL"].toString();
                if(authorization.startsWith("https://clerk.sessionstream.app/")&&authorization!=lastLinkAuthorization&&static_cast<juce::int64>(data["links"]["authorizationSource"])==source){lastLinkAuthorization=authorization;juce::URL(authorization).launchInDefaultBrowser();}
                lifetimeSupported=static_cast<int>(data["engineProtocol"])>=1;
                if(!lifetimeSupported||static_cast<int>(data["controlProtocol"])<10){
                    next.message=bool(data["live"])?"Stop the old SessionStream session to update its engine.":"Updating streaming engine...";
                    if(!bool(data["live"]))launch(true);
                    publish(next);wait(250);continue;
                }
                if(lifetimeSupported&&!engine("attach")){next.message="Reconnecting streaming engine...";publish(next);wait(250);continue;}
                if(ending){
                    const bool mine=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                    if(!mine||action("end")){ending=false;owned=false;}
                    next.ending=ending;next.live=false;next.ready=!ending;next.link.clear();next.message=ending?"Ending session...":"Session ended.";publish(next);wait(250);continue;
                }
                juce::var receiveCommand;uint64_t revision=0;
                {const juce::ScopedLock l(lock);revision=receiveRevision;if(revision!=appliedReceive){
                    auto* command=new juce::DynamicObject();command->setProperty("action",receiveDesired?"start":"stop");command->setProperty("source",static_cast<juce::int64>(source));command->setProperty("target",receiveTarget);command->setProperty("passcode",receivePasscode);command->setProperty("port",receivePort);command->setProperty("transport",receiveLowLatency?"webrtc":"pcm");receiveCommand=juce::var(command);
                }}
                if(!receiveCommand.isVoid()){
                    receiveError.clear();const auto result=request("/api/receive",receiveCommand);
                    if(bool(result["ok"]))appliedReceive=revision;
                    else if(result["error"].toString().isNotEmpty()){appliedReceive=revision;receiveError=result["error"].toString();}
                }
                const auto rx=data["receivers"][juce::Identifier(juce::String(source))];next.receivePhase=rx["phase"].toString();next.receiveTransport=rx["transport"].toString().isEmpty()?juce::String("pcm"):rx["transport"].toString();
                next.receiveChannels=juce::jmax(1,static_cast<int>(rx["channels"]));
                next.receiveMessage=receiveError.isNotEmpty()?receiveError:rx["message"].toString();if(receiveError.isNotEmpty())next.receivePhase="error";next.receiving=next.receivePhase=="receiving";
                if(handoffRequested.exchange(false)){
                    if(action("handoff")){owned=true;const auto refreshed=request("/api/studio");if(refreshed.isObject())data=refreshed;}
                }
                const bool wasOwned=owned;
                owned=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                const bool ownedElsewhere=!data["inviteSource"].isVoid()&&!owned;
                // A lost Generate response may have ended the pending UI state.
                // The engine's matching request ID still confirms its passcode.
                if(owned&&requestId.isNotEmpty()&&data["inviteRequest"].toString()==requestId)
                    sessionPasscode=requestPasscode;
                if(wasOwned&&ownedElsewhere){if(onYielded)onYielded();}
                next.hasSession=owned;if(owned){useCloud.store(next.delivery=="cloud");encryptAudio(next.encrypted);}
                else if(next.accountPhase=="signed-out"||(next.planKnown&&next.accountPhase=="signed-in")){
                    const bool pro=next.planKnown&&next.plan=="pro"&&next.accountPhase=="signed-in";
                    useCloud.store(pro&&(deliveryChoice.load()<0||deliveryChoice.load()==1));
                }
                next.activeElsewhere=ownedElsewhere;
                next.handoffReady=ownedElsewhere&&!bool(data["inviteExpired"]);
                const auto owner=data["owner"];const bool mine=!owner.isVoid()&&static_cast<juce::int64>(owner)==source;
                const bool busy=(!owner.isVoid()&&!mine)||ownedElsewhere;
                auto link=data["listenerURL"].toString();const bool modern=static_cast<int>(data["controlProtocol"])>=2;
                next.transportDiagnostics=data["transportDiagnostics"];next.streamChannels=static_cast<int>(data["format"]["channels"]);if(!streamformat::validChannels(next.streamChannels))next.streamChannels=2;for(int q=0;q<9;++q)if(data["quality"].toString()==streamformat::ids[q])next.streamQuality=q;ownedChannels.store(owned?next.streamChannels:0);
                next.ready=!busy;
                if(busy){
                    next.listeners=static_cast<int>(data["listeners"]);
                    next.message=next.handoffReady?"Session active on another track. Click Stream from this track to switch.":"Another plugin is using this session.";
                }
                else{
                    // Recover a protected session without silently opening an
                    // unprotected invite after a helper restart or host bypass.
                    // This code lives only in this processor's memory.
                    const bool pro=next.planKnown&&next.plan=="pro"&&next.accountPhase=="signed-in";
                    if(desired&&(!owned||(!pro&&(data["quality"].toString()!="balanced"||static_cast<int>(data["format"]["channels"])!=2)))&&!generating&&!generateRequested.load()){
                        generating=true;acknowledged=false;requestId=juce::Uuid().toString();requestPasscode=sessionPasscode;
                    }
                    // A lost POST response is harmless: the same request ID is
                    // acknowledged by GET and repeated requests never rotate twice.
                    if(generating&&modern&&owned&&data["inviteRequest"].toString()==requestId)acknowledged=true;
                    const bool needsPlan=listenerPreferences()!=0||prefersCustomLink()||sessionQuality.load()!=1||sessionChannels.load()!=2;
                    const bool planReady=(next.accountPhase!="signed-in"||next.planKnown)&&(!needsPlan||next.planKnown||next.accountPhase=="signed-out");
                    if(generating&&!acknowledged&&planReady){acknowledged=action("generate",requestId,requestPasscode,pro);if(!acknowledged&&controlError.isNotEmpty()){generating=false;generateRequested=false;if(desired&&onExpired)onExpired();}}
                    if(generating&&acknowledged){const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}
                    const bool ownsInvite=!data["inviteSource"].isVoid()&&static_cast<juce::int64>(data["inviteSource"])==source;
                    const bool readyNow=link.startsWith("https://")&&(!modern||bool(data["publicSiteReady"]));
                    next.ready=true;
                    if(generating&&acknowledged&&ownsInvite&&readyNow&&(!modern||data["inviteRequest"].toString()==requestId)){generating=false;owned=true;sessionPasscode=requestPasscode;}
                    // A UI Start can queue a protected invite while this poll
                    // is already in flight. Consume that request before audio
                    // starts, rather than creating a temporary open invite.
                    if(desired&&readyNow&&(ownsInvite||planReady&&!requiresPasscode())&&!bool(data["inviteExpired"])&&!generating&&!generateRequested.load()&&!bool(data["live"])){if(action("start",{},{},pro)){owned=true;const auto refreshed=request("/api/studio");if(refreshed.isObject()){data=refreshed;link=data["listenerURL"].toString();}}}
                    if(!desired&&ownsInvite&&bool(data["live"]))action("stop");
                    if(ownsInvite)action("lease");
                    if(readyNow&&ownsInvite&&!generating)next.link=link;
                    next.live=desired&&bool(data["live"])&&ownsInvite;next.listeners=static_cast<int>(data["listeners"]);
                    next.passcodeRequired=ownsInvite&&bool(data["passcodeRequired"]);
                    next.inviteExpired=ownsInvite&&bool(data["inviteExpired"]);next.streamStartedAt=ownsInvite?static_cast<juce::int64>(data["streamStartedAt"]):0;
                    if(next.inviteExpired){next.live=false;next.link.clear();next.message="Invite expired. Start streaming to create a new one.";}
                    const auto phase=data["tunnelPhase"].toString();
                    next.message=(!ownsInvite&&!generating&&!desired)?"Ready":!readyNow?(phase=="retrying"?"Retrying your connection...":phase=="verifying"?"Checking your share link...":"Connecting..."):
                        generating?"Creating link...":next.live?"Streaming":ownsInvite?"Ready":"Ready";
                    if(next.inviteExpired){next.message="Invite expired. Start streaming to create a new one.";if(desired&&!generating&&!generateRequested.load()&&onExpired)onExpired();}
                    if(!data["engineError"].isVoid())next.message="Connection issue: "+data["engineError"].toString();
                    const auto cloudError=data["accountError"].toString();if(controlError.isNotEmpty()||cloudError.isNotEmpty()){next.warning=true;next.message=controlError.isNotEmpty()?controlError:cloudError;if(desired&&onExpired)onExpired();}
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
            next.generating=generating;publish(next);wait(250);
        }
        detach();
    }
};
