#include "Processor.h"
#include "InviteQR.h"
#include "ListenerPanel.h"
#include "Diagnostics.h"
#include "StudioLookAndFeel.h"
#include "BinaryData.h"
#include "SpectrumView.h"
#include "ModernButton.h"
#include "SessionSetup.h"

juce::String StreamProcessor::diagnostics() const {
    // Logs are redacted before writing. Never serialize controller credentials.
    const auto state=controller->status();
    auto* data=new juce::DynamicObject;
    data->setProperty("version",UpdateChecker::currentVersion);
    data->setProperty("os",juce::SystemStats::getOperatingSystemName());
#if JUCE_ARM
    data->setProperty("pluginArchitecture","ARM64");
#else
    data->setProperty("pluginArchitecture","x64");
#endif
    data->setProperty("pluginFormat",getWrapperTypeDescription(wrapperType));
    data->setProperty("hostEnabled",isHostEnabled());
    data->setProperty("streamingRequested",isSending());
    data->setProperty("mode",isReceiveMode()?"receive":"send");
    data->setProperty("receivingRequested",isReceiving());
    data->setProperty("receivePhase",state.receivePhase);
    data->setProperty("receiveTransport",state.receiveTransport);
    data->setProperty("receiveBufferMs",receiveBufferMs());
    data->setProperty("engineAvailable",state.available);
    data->setProperty("creatingInvite",state.generating);
    data->setProperty("inviteReady",state.link.isNotEmpty());
    data->setProperty("live",state.live);
    data->setProperty("listeners",state.listeners);
    data->setProperty("playbackWarning",state.warning);
    data->setProperty("connectionReady",state.ready);
    data->setProperty("offlineRendering",isNonRealtime());
    data->setProperty("sessionEnabled",shouldKeepSession());
    data->setProperty("sampleRate",int(currentRate.load()));
    auto* lifecycle=new juce::DynamicObject;
    lifecycle->setProperty("prepare",juce::int64(prepareCount.load()));
    lifecycle->setProperty("release",juce::int64(releaseCount.load()));
    lifecycle->setProperty("reset",juce::int64(resetCount.load()));
    lifecycle->setProperty("offlineBlocks",juce::int64(offlineBlocks.load()));
    lifecycle->setProperty("packetsSent",juce::int64(transport.sent.load()));
    lifecycle->setProperty("packetsDropped",juce::int64(transport.dropped.load()));
    data->setProperty("audioLifecycle",juce::var(lifecycle));
    juce::Array<juce::var> controllerLogs;for(const auto& line:controller->logs())controllerLogs.add(line);
    data->setProperty("controllerLogs",controllerLogs);
    data->setProperty("runtimeLogs",sessionstream::runtimeLogs());
    data->setProperty("transportDiagnostics",state.transportDiagnostics);
    return juce::JSON::toString(juce::var(data));
}

StreamProcessor::StreamProcessor(UpdateChecker::Fetch reader,int streamPort)
    : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)),
      transport(streamPort),
      updates(std::move(reader)) {
    sendParameter=new juce::AudioParameterBool(juce::ParameterID("send",1),"Send audio",false);addParameter(sendParameter);
    gainParameter=new juce::AudioParameterFloat(juce::ParameterID("streamGain",1),"Stream output dB",juce::NormalisableRange<float>(-60.f,12.f,.1f),0.f);addParameter(gainParameter);
    bypassParameter=new juce::AudioParameterBool(juce::ParameterID("bypass",1),"Bypass",false);addParameter(bypassParameter);
    muteParameter=new juce::AudioParameterBool(juce::ParameterID("localMute",1),"Mute local monitor",false);addParameter(muteParameter);
    controller=std::make_unique<StreamController>(transport.getSourceId(),[this]{return isSending();},"http://127.0.0.1:8788",juce::File{},[this]{
        const bool active=isHostEnabled();
        if(!active)transport.enabled=false;
        return shouldKeepSession();
    },[this]{setSending(false);},[this]{setSending(false);setLocalMuted(false);});
}

bool StreamProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    return l.getMainInputChannelSet()==l.getMainOutputChannelSet()&&(l.getMainInputChannelSet()==juce::AudioChannelSet::stereo()||l.getMainInputChannelSet()==juce::AudioChannelSet::mono()||l.getMainInputChannelSet()==juce::AudioChannelSet::create5point1()||l.getMainInputChannelSet()==juce::AudioChannelSet::create7point1());
}

void StreamProcessor::processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer&) {
    // Offline callbacks must never latch a disabled state into the next live
    // session. In particular, Live may pause before its first realtime block.
    if(isNonRealtime()){loudness.clear();receiver.enabled=false;receiver.flush();sendLimiterActive.store(false,std::memory_order_relaxed);if(isReceiveMode())b.clear();++offlineBlocks;transport.enabled=false;transport.resetPending();return;}
    hostActivity.block(bypassParameter->get());
    if(bypassParameter->get()){loudness.clear();receiver.enabled=false;receiver.flush();sendLimiterActive.store(false,std::memory_order_relaxed);transport.enabled=false;transport.resetPending();return;}
    juce::ScopedNoDenormals guard;transport.enabled.store(isSending()&&!isSuspended(),std::memory_order_relaxed);
    if(b.getNumChannels()<1||b.getNumSamples()<1)return;
    const int r=b.getNumChannels()>1?1:0,n=b.getNumSamples();
    gain.setTargetValue(juce::Decibels::decibelsToGain(gainParameter->get()));
    const float first=gain.getCurrentValue(),last=gain.skip(n),step=(last-first)/n;
    if(isReceiveMode()){
        transport.enabled=false;transport.resetPending();sendLimiterActive.store(false,std::memory_order_relaxed);
        receiver.enabled=isReceiving()&&!isSuspended();
        receiver.render(b.getArrayOfWritePointers(),b.getNumChannels(),n,currentRate,first,step);
    }
    signalCapture.push(b.getReadPointer(0),b.getReadPointer(r),n,isReceiveMode()?1.f:first,isReceiveMode()?0.f:step);
    float lPeak=0,rPeak=0;
    const bool receiving=isReceiveMode();
    for(int i=0;i<n;i++){
        const auto scale=receiving?1.f:first+step*i;
        const auto left=b.getSample(0,i)*scale,right=b.getSample(r,i)*scale;
        lPeak=juce::jmax(lPeak,std::abs(left));
        rPeak=juce::jmax(rPeak,std::abs(right));
        loudness.push(left,right,r!=0);
    }
    if(!receiving&&juce::jmax(lPeak,rPeak)>=.89125f)sendLimiterActive.store(true,std::memory_order_relaxed);
    else if(!receiving)sendLimiterActive.store(false,std::memory_order_relaxed);
    transport.leftPeak.store(juce::jmax(lPeak,transport.leftPeak.load()));transport.rightPeak.store(juce::jmax(rPeak,transport.rightPeak.load()));
    if(!isReceiveMode()&&transport.enabled.load())transport.push(b.getArrayOfReadPointers(),b.getNumChannels(),controller&&controller->hasProAudio()?controller->audioChannels(streamChannels.load()):2,n,currentRate,first,step);else transport.resetPending();
    localMonitor.setTargetValue(localMuted()&&isSending()&&!isReceiveMode()?0.f:1.f);
    const auto monitorFirst=localMonitor.getCurrentValue(),monitorLast=localMonitor.skip(n);
    b.applyGainRamp(0,n,monitorFirst,monitorLast);
}

void StreamProcessor::processBlockBypassed(juce::AudioBuffer<float>&,juce::MidiBuffer&) {
    loudness.clear();sendLimiterActive.store(false,std::memory_order_relaxed);
    if(!isNonRealtime())hostActivity.block(true);receiver.enabled=false;receiver.flush();transport.enabled=false;transport.resetPending();
}

void StreamProcessor::getStateInformation(juce::MemoryBlock& state) {
    juce::MemoryOutputStream stream(state,false);
    stream.writeFloat(gainDb());
    stream.writeInt(0x53535231);
    stream.writeBool(isReceiveMode());
    stream.writeInt(streamQuality.load());
    int flags=controller
        ?(controller->listenerPreferences()&3)|(controller->sharesHostName()?4:0)|(controller->requiresPasscode()?8:0)|(controller->prefersCustomLink()?16:0)
        :0;
    if(controller&&(controller->listenerPreferences()&4)!=0)flags|=1024;
    flags|=32768; // Saved link choice is distinct from the account default.
    if(controller&&controller->hasCustomLinkPreference())flags|=65536;
    flags|=16384; // New state records whether delivery was explicitly chosen.
    if(controller&&controller->hasDeliveryPreference())flags|=8192;
    if(controller&&(controller->hasDeliveryPreference()?controller->preferredCloudDelivery():controller->usesCloud()))flags|=2048;
    if(controller&&!controller->encryptsAudio())flags|=4096;
    if(receiveLowLatency.load())flags|=32;
    flags|=((receiveBufferIndex.load()&3)<<6);
    flags|=((uiScaleIndex.load()&3)<<8);
    stream.writeInt(flags);stream.writeInt(streamChannels.load());
}

void StreamProcessor::setStateInformation(const void* data,int size) {
    // Keep legacy gain-only projects compatible. Save the mode, never a
    // connection activation, passcode, or account credential. Restoring the
    // same mode during render must leave the current session running.
    if(size!=4&&size!=9&&size!=17&&size!=21)return;
    juce::MemoryInputStream stream(data,static_cast<size_t>(size),false);
    const auto db=stream.readFloat();
    if(std::isfinite(db))setGainDb(juce::jlimit(-60.f,12.f,db));
    if(size>=9&&stream.readInt()==0x53535231){
        const bool mode=stream.readBool();
        if(mode!=isReceiveMode())setReceiveMode(mode);
        if(size>=17){
            streamQuality=juce::jlimit(0,8,stream.readInt());
            const auto flags=stream.readInt();const auto channels=size>=21?stream.readInt():2;streamChannels=streamformat::validChannels(channels)?channels:2;if(!streamformat::pcm(streamQuality)&&streamChannels>2)streamChannels=2;
            linkExpiryHours=0;
            receiveLowLatency.store((flags&32)!=0);
            setReceiveBufferIndex((flags>>6)&3);
            uiScaleIndex.store(juce::jlimit(0,2,(flags>>8)&3));
            if(controller){
                controller->restoreCloudDelivery((flags&2048)!=0,(flags&16384)==0||(flags&8192)!=0);
                controller->encryptAudio((flags&4096)==0);
                controller->restoreListenerPreferences((flags&3)|((flags&1024)?4:0));
                controller->shareHostName((flags&4)!=0);
                controller->requirePasscode((flags&8)!=0);
                controller->restoreCustomLink((flags&16)!=0,(flags&32768)!=0?(flags&65536)!=0:(flags&16)!=0);
            }
        }
    }
    if(controller)controller->sessionSettings(streamQuality,linkExpiryHours,streamChannels);
}

// Keep QR content owned by the editor, so host removal destroys it together
// with the plugin rather than leaving a deferred popup callback behind.
class InviteOverlay final : public juce::Component {
public:
    InviteOverlay(){addAndMakeVisible(qr);qr.onClose=[this]{setVisible(false);};setWantsKeyboardFocus(true);}
    void show(const juce::String& link){qr.setInvite(link);setVisible(true);toFront(true);grabKeyboardFocus();}
    void refresh(const juce::String& link){if(isVisible()&&qr.getEncodedInvite()!=link)qr.setInvite(link);}
    void resized() override {qr.setTopLeftPosition((getWidth()-qr.getWidth())/2,(getHeight()-qr.getHeight())/2);}
    void paint(juce::Graphics& g) override {g.fillAll(juce::Colour(0xe0111713));}
    bool keyPressed(const juce::KeyPress& key) override {if(key==juce::KeyPress::escapeKey){setVisible(false);return true;}return false;}
private:
    InviteQR qr;
};

// Covers this editor only; the DAW remains usable while a link is prepared.
class LinkProgressOverlay final : public juce::Component,private juce::Timer {
public:
    std::function<void()> onCancel;
    LinkProgressOverlay(){
        setComponentID("link-progress");setTitle("Creating link");setInterceptsMouseClicks(true,true);
        addAndMakeVisible(cancel);cancel.setComponentID("cancel-link-creation");cancel.setButtonText("Cancel");
        cancel.onClick=[this]{if(onCancel)onCancel();};
    }
    void show(bool cancelling){
        stopping=cancelling;cancel.setEnabled(!stopping);cancel.refreshStyle();
        const bool opening=!isVisible();setVisible(true);toFront(false);
        if(opening){startTimerHz(30);cancel.grabKeyboardFocus();}
        repaint();
    }
    void hide(){setVisible(false);stopTimer();}
    void resized() override {cancel.setBounds(getWidth()/2-60,getHeight()/2+43,120,34);}
    void paint(juce::Graphics& g) override {
        g.fillAll(studio::background.withAlpha(.94f));
        const float x=getWidth()*.5f,y=getHeight()*.5f;
        auto box=juce::Rectangle<float>(x-172,y-99,344,198);
        g.setColour(studio::panel);g.fillRoundedRectangle(box,8);
        g.setColour(studio::line);g.drawRoundedRectangle(box,8,1);
        const auto angle=float(std::fmod(juce::Time::getMillisecondCounterHiRes()*.004,juce::MathConstants<double>::twoPi));
        juce::Path arc;arc.addCentredArc(x,y-47,14,14,0,angle,angle+juce::MathConstants<float>::pi*1.45f,true);
        g.setColour(studio::violet);g.strokePath(arc,juce::PathStrokeType(2,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
        g.setColour(studio::text);g.setFont(studio::font(17,true));
        g.drawText(stopping?"Cancelling…":"Creating your link",int(x)-150,int(y)-13,300,28,juce::Justification::centred);
    }
    bool keyPressed(const juce::KeyPress& key) override {
        if(key==juce::KeyPress::escapeKey){if(!stopping&&onCancel)onCancel();return true;}
        return key.getKeyCode()==juce::KeyPress::tabKey;
    }
private:
    studio::ModernButton cancel;bool stopping=false;
    void timerCallback() override{repaint();}
};

class StreamEditor final : public juce::AudioProcessorEditor,private juce::Timer {
public:
    explicit StreamEditor(StreamProcessor& processor):AudioProcessorEditor(processor),p(processor){
        setLookAndFeel(&look);
        addMouseListener(this,true);
        p.signalCapture.drain([](SignalCapture::Frame){});p.signalCapture.active=true;
        addAndMakeVisible(spectrum);spectrum.setComponentID("live-spectrum");
        logo=juce::Drawable::createFromImageData(BinaryData::WebsiteMark_svg,BinaryData::WebsiteMark_svgSize);

        for(auto* b:{&sendMode,&receiveMode,&rxLiveMode,&rxPcmMode,&rxBuf40,&rxBuf90,&rxBuf200})b->getProperties().set("role","segment");
        sendMode.getProperties().set("role","mode");receiveMode.getProperties().set("role","mode");
        more.getProperties().set("role","quiet");
        accountButton.getProperties().set("role","account");
        toggle.getProperties().set("role","primary");
        localMute.getProperties().set("role","secondary");
        addAndMakeVisible(localMute);
        addAndMakeVisible(setupButton);setupButton.getProperties().set("role","nav");setupButton.setComponentID("session-setup");setupButton.setButtonText("Settings");setupButton.setTitle("Session settings");setupButton.onClick=[this]{showingSetup=true;showingPeople=false;timerCallback();};
        addAndMakeVisible(sessionPageButton);sessionPageButton.getProperties().set("role","nav");sessionPageButton.setComponentID("session-page");sessionPageButton.setButtonText("Session");sessionPageButton.onClick=[this]{showingSetup=false;showingPeople=false;timerCallback();};
        addAndMakeVisible(peopleButton);peopleButton.setButtonText("Listeners");peopleButton.setComponentID("session-listeners");peopleButton.getProperties().set("role","nav");peopleButton.onClick=[this]{showingPeople=true;showingSetup=false;timerCallback();};

        setupButton.setIcon(studio::ModernButton::Icon::settings);setupButton.setIconOnly(true);
        peopleButton.setIcon(studio::ModernButton::Icon::users);
        toggle.setIconOnly(true);endButton.setIcon(studio::ModernButton::Icon::stop);endButton.setIconOnly(true);localMute.setIconOnly(true);qrButton.setIconOnly(true);
        includePasscode.setComponentID("include-passcode");includePasscode.setButtonText("Include passcode");includePasscode.setTooltip("Include the session passcode when copying the invite. This does not change session access.");includePasscode.setToggleState(true,juce::dontSendNotification);addChildComponent(includePasscode);
        addChildComponent(listenerPanel);listenerPanel.onAction=[this](juce::var command){p.controller->manageListeners(command);};
        addAndMakeVisible(endButton);endButton.setComponentID("end-session");endButton.getProperties().set("role","secondary");endButton.setTooltip("Disconnect everyone and invalidate this invite. Your custom name stays reserved.");
        endButton.onClick=[this]{
            if(s.ending||(!sessionLatched&&!p.isSending()&&!s.generating))return;
            if(endConfirmTicks==0){endConfirmTicks=100;timerCallback();return;}
            endConfirmTicks=0;p.setSending(false);p.setLocalMuted(false);p.controller->requirePasscode(false);p.controller->endSession();waitingInviteSettings=false;inviteSettingsDirty=true;
            studio::syncToggleState(usePasscode,false);passcode.clear();invite.clear();timerCallback();
        };
        addChildComponent(useDirect);useDirect.setButtonText("Use Direct instead");useDirect.setComponentID("cloud-direct-fallback");useDirect.setTooltip("Direct streaming uses no Cloud hours. Pro supports up to eight direct listeners.");useDirect.onClick=[this]{if(p.isSending()||s.generating||s.ending)return;if(sessionLatched)p.controller->endSession();p.controller->chooseCloudDelivery(false);inviteSettingsDirty=true;timerCallback();};
        localMute.setComponentID("mute-local");localMute.setIcon(studio::ModernButton::Icon::speaker);localMute.setTooltip("Silences this plugin's local DAW output while streaming. Listeners still hear the stream.");localMute.onClick=[this]{p.setLocalMuted(!p.localMuted());timerCallback();};
        setupOverlay.onDelivery=[this](bool cloud){if(sessionLatched||p.isSending()||s.generating||s.ending)return;p.controller->chooseCloudDelivery(cloud);inviteSettingsDirty=true;timerCallback();};
        setupOverlay.onEncryption=[this](bool value){if(sessionLatched||p.isSending()||s.generating||s.ending)return;p.controller->encryptAudio(value);inviteSettingsDirty=true;};
        setupOverlay.setComponentID("setup-panel");addChildComponent(setupOverlay);setupOverlay.onChange=[this](int q,int channels){if(sessionLatched||p.isSending()||s.generating||s.ending)return;if(q!=p.streamQuality||channels!=p.streamChannels){p.streamQuality=q;p.streamChannels=channels;p.linkExpiryHours=0;p.controller->sessionSettings(q,0,channels);inviteSettingsDirty=true;}};
        addChildComponent(showHostName);
        showHostName.setButtonText("Show my name to listeners");
        studio::syncToggleState(showHostName,p.controller->sharesHostName());
        showHostName.setTooltip("Use your account display name on the next invitation. Off keeps the invitation anonymous.");
        showHostName.onClick=[this]{p.controller->shareHostName(showHostName.getToggleState());};

        copy.setIcon(studio::ModernButton::Icon::copy);
        copyWithPasscode.setIcon(studio::ModernButton::Icon::copy);
        qrButton.setIcon(studio::ModernButton::Icon::qr);
        generate.setIcon(studio::ModernButton::Icon::link);
        toggle.setIcon(studio::ModernButton::Icon::play);
        accountButton.setIcon(studio::ModernButton::Icon::account);
        more.setIcon(studio::ModernButton::Icon::more);

        const std::pair<juce::Component*,const char*> ids[]{
            {&generate,"new-link"},{&copy,"copy-link"},{&copyWithPasscode,"copy-with-passcode"},{&qrButton,"qr-code"},{&toggle,"stream-toggle"},
            {&linkKind,"link-kind"},{&customName,"custom-name"},{&claimLink,"save-name"},{&usePasscode,"use-passcode"},
            {&passcode,"session-passcode"},{&receiveTarget,"receive-target"},{&receivePasscode,"receive-passcode"},
            {&level,"stream-gain"},{&sendMode,"send-mode"},{&receiveMode,"receive-mode"},{&qrOverlay,"qr-overlay"},
            {&update,"get-update"},{&ignoreUpdate,"ignore-update"}};
        for(const auto& item:ids)item.first->setComponentID(item.second);
        customName.setTitle("Custom link name");passcode.setTitle("Session passcode");receiveTarget.setTitle("Host invite");receivePasscode.setTitle("Receive passcode");invite.setTitle("Session link");

        for(auto* b:{&generate,&copy,&copyWithPasscode,&qrButton,&toggle,&update,&ignoreUpdate,&sendMode,&receiveMode,&claimLink,&rxLiveMode,&rxPcmMode,&rxBuf40,&rxBuf90,&rxBuf200}){
            addAndMakeVisible(b);
            b->setColour(juce::TextButton::buttonColourId,juce::Colour(0xff263129));
            b->setColour(juce::TextButton::textColourOffId,studio::text);
        }
        sendMode.setButtonText("Send");receiveMode.setButtonText("Receive");claimLink.setButtonText("Save name");
        sendMode.onClick=[this]{if(!p.isSending()&&!p.isReceiving()&&p.isReceiveMode()){p.setReceiveMode(false);timerCallback();}};
        receiveMode.onClick=[this]{if(!p.isSending()&&!p.isReceiving()&&!p.isReceiveMode()){p.setReceiveMode(true);timerCallback();}};

        rxLiveMode.setButtonText("Live WebRTC");rxLiveMode.setTooltip("Low-latency Opus stereo over WebRTC (falls back to PCM automatically).");
        rxPcmMode.setButtonText("Lossless PCM");rxPcmMode.setTooltip("Uncompressed PCM with the source channel layout and bit depth.");
        rxLiveMode.onClick=[this]{if(!p.isReceiving()){p.receiveLowLatency=true;timerCallback();}};
        rxPcmMode.onClick=[this]{if(!p.isReceiving()){p.receiveLowLatency=false;timerCallback();}};

        rxBuf40.setButtonText("40 ms");rxBuf90.setButtonText("90 ms");rxBuf200.setButtonText("200 ms");
        rxBuf40.onClick=[this]{p.setReceiveBufferIndex(0);timerCallback();};
        rxBuf90.onClick=[this]{p.setReceiveBufferIndex(1);timerCallback();};
        rxBuf200.onClick=[this]{p.setReceiveBufferIndex(2);timerCallback();};

        addAndMakeVisible(linkKind);linkKind.addItem("Random code",1);linkKind.addItem("Custom link",2);linkKind.setSelectedId(1,juce::dontSendNotification);
        linkKind.onChange=[this]{inviteSettingsDirty=true;const bool custom=linkKind.getSelectedId()==2;p.controller->preferCustomLink(custom);if(!sessionLatched&&!p.isSending())p.controller->links("mode",custom?"custom":"random");};
        for(auto* field:{&customName,&receiveTarget,&receivePasscode}){addAndMakeVisible(field);field->setFont(studio::font(12));field->setIndents(10,7);field->setColour(juce::TextEditor::backgroundColourId,studio::inset);field->setColour(juce::TextEditor::textColourId,studio::text);}
        customName.setTextToShowWhenEmpty("Choose a name",studio::muted);customName.onTextChange=[this]{nameDirty=customName.getText()!=s.customName;};customName.setInputRestrictions(32,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");customName.setTooltip(juce::String::fromUTF8("sessionstream.app/your-name \xE2\x80\x94 one name per account. Saving another name releases the previous one."));
        receiveTarget.setTextToShowWhenEmpty("Share code, custom name or full link",studio::muted);receiveTarget.setInputRestrictions(512);
        receivePasscode.setTextToShowWhenEmpty("Passcode (if needed)",studio::muted);receivePasscode.setPasswordCharacter(0x2022);receivePasscode.setInputRestrictions(64);
        claimLink.onClick=[this]{p.controller->links("claim",customName.getText());};
        customName.onReturnKey=[this]{if(claimLink.isEnabled())claimLink.triggerClick();};
        generate.setButtonText("Create link");copy.setButtonText("Copy invite");copyWithPasscode.setButtonText("Copy with passcode");toggle.setButtonText("Start streaming");
        qrButton.setButtonText("QR code");qrButton.onClick=[this]{qrOverlay.show(p.controller->status().link);};
        addAndMakeVisible(usePasscode);usePasscode.setButtonText("Passcode");usePasscode.setColour(juce::ToggleButton::textColourId,studio::muted);
        addAndMakeVisible(passcode);passcode.setPasswordCharacter(0x2022);passcode.setInputRestrictions(64);passcode.setTextToShowWhenEmpty("Passcode",studio::muted);passcode.setFont(studio::font(12));passcode.setIndents(10,7);passcode.setColour(juce::TextEditor::backgroundColourId,studio::inset);passcode.setColour(juce::TextEditor::textColourId,studio::text);passcode.setVisible(false);
        passcode.onTextChange=[this]{inviteSettingsDirty=true;};
        usePasscode.onClick=[this]{p.controller->requirePasscode(usePasscode.getToggleState());inviteSettingsDirty=true;passcode.setVisible(usePasscode.getToggleState());passcode.setEnabled(usePasscode.getToggleState());if(usePasscode.getToggleState())passcode.grabKeyboardFocus();else passcode.clear();};
        generate.onClick=[this]{if(p.isReceiveMode()){p.connectReceive(false);return;}const auto status=p.controller->status();if(!p.isHostEnabled()||!status.ready||status.generating||p.isSending())return;if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}waitingInviteSettings=true;generate.setEnabled(false);usePasscode.setEnabled(false);passcode.setEnabled(false);p.setSending(false);p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{},p.streamQuality,0);};
        copy.onClick=[this]{const auto status=p.controller->status();const auto code=p.controller->activePasscode();const bool withCode=includePasscode.getToggleState()&&status.passcodeRequired&&code.isNotEmpty();juce::SystemClipboard::copyTextToClipboard(status.link+(withCode?"\nPasscode: "+code:juce::String{}));copy.setButtonText("Copied");copiedTicks=30;};
        copyWithPasscode.onClick=[this]{
            const auto link=p.controller->status().link,code=p.controller->activePasscode();
            if(link.isNotEmpty()&&code.isNotEmpty()){
                juce::SystemClipboard::copyTextToClipboard(link+"\nPasscode: "+code);
                copyWithPasscode.setButtonText("Copied invite + passcode");
                copiedPasscodeTicks=36;
            }
        };
        toggle.onClick=[this]{
            if(p.isReceiveMode()){
                const auto rx=p.controller->status();
                const bool retry=rx.receivePhase=="error"||rx.receivePhase=="passcode"||rx.receivePhase=="denied";
                p.connectReceive(retry||!p.isReceiving(),receiveTarget.getText(),receivePasscode.getText());
                return;
            }
            const auto status=p.controller->status();
            if(p.isSending()){p.setSending(false);return;}
            if(status.handoffReady&&p.isHostEnabled()&&!status.ending&&(status.streamChannels<=2||status.streamChannels==p.getMainBusNumInputChannels())){p.streamChannels=status.streamChannels;p.streamQuality=status.streamQuality;p.controller->sessionSettings(p.streamQuality,0,p.streamChannels);
                p.controller->handoff();
                p.setSending(true);
                return;
            }
            if(!p.isHostEnabled()||!status.ready||status.generating||status.ending)return;
            if(status.link.isEmpty()||inviteSettingsDirty){
                waitingInviteSettings=true;
                if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}
                p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{},p.streamQuality,0);
            }
            p.setSending(true);timerCallback();
        };
        addAndMakeVisible(invite);invite.setReadOnly(true);invite.setFont(studio::font(12));invite.setIndents(10,8);invite.setTextToShowWhenEmpty("Your private link appears here",studio::muted);invite.setColour(juce::TextEditor::backgroundColourId,studio::inset);invite.setColour(juce::TextEditor::textColourId,studio::muted);
        addAndMakeVisible(level);level.setTooltip("Adjusts stream output only. DAW output is unchanged. Double-click for 0 dB.");
        level.setRange(-60,12,.1);level.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);level.setTextBoxStyle(juce::Slider::TextBoxBelow,false,80,22);
        level.setSkewFactorFromMidPoint(0.0); // Places 0 dB unity exactly at 12 o'clock
        level.setTextValueSuffix(" dB");level.setValue(p.gainDb());level.setColour(juce::Slider::trackColourId,studio::accent);
        level.setDoubleClickReturnValue(true,0.f);
        level.onDragStart=[this]{dragging=true;};level.onDragEnd=[this]{dragging=false;};level.onValueChange=[this]{p.setGainDb(static_cast<float>(level.getValue()));};

        update.setButtonText("Get update");ignoreUpdate.setButtonText("Ignore for this session");
        update.onClick=[this]{const auto phase=s.updater["phase"].toString();if(phase=="ready")p.controller->updatePlugin(2);else if(phase=="complete"||phase=="cancelled"){p.controller->updatePlugin(4);p.updates.ignoreForSession();}else p.controller->updatePlugin(1);};
        ignoreUpdate.onClick=[this]{const auto phase=s.updater["phase"].toString();p.controller->updatePlugin(phase=="downloading"||phase=="ready"||phase=="waiting"?3:4);p.updates.ignoreForSession();refreshUpdate();};
        update.setVisible(false);ignoreUpdate.setVisible(false);
        addChildComponent(qrOverlay);
        addChildComponent(linkProgress);linkProgress.onCancel=[this]{cancellingLink=true;p.setSending(false);p.setLocalMuted(false);p.controller->endSession();waitingInviteSettings=false;inviteSettingsDirty=true;timerCallback();};

        addAndMakeVisible(accountButton);accountButton.setButtonText("Sign in");
        accountButton.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff161e19));
        accountButton.setColour(juce::TextButton::textColourOffId,studio::text);
        accountButton.onClick=[this]{
            if(s.reconnectRequired&&s.accountPhase=="signed-in"){p.controller->reconnectAccount();return;}
            if(s.accountPhase!="signed-in"){p.controller->account(s.accountPhase!="signing-in");return;}
            juce::PopupMenu menu;menu.setLookAndFeel(&look);if(s.canCloud)menu.addSectionHeader("Cloud: "+juce::String(s.cloudHoursRemaining,1)+" Cloud hours left");menu.addItem(1,"Sign out");menu.addItem(3,"Open account dashboard");if(s.planKnown&&s.plan=="pro"&&s.customName.isNotEmpty())menu.addItem(2,"Release custom link");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&accountButton).withParentComponent(this),[safe](int result){if(safe&&result==1)safe->p.controller->account(false);if(safe&&result==2)safe->p.controller->links("release");if(safe&&result==3)juce::URL("https://sessionstream.app/dashboard/").launchInDefaultBrowser();});
        };

        addAndMakeVisible(more);more.setButtonText({});more.setTooltip("More options");more.setTitle("More options");
        more.setColour(juce::TextButton::buttonColourId,juce::Colours::transparentBlack);more.setColour(juce::TextButton::textColourOffId,studio::muted);
        more.onClick=[this]{
            const int curScale=p.uiScaleIndex.load();
            juce::PopupMenu scaleMenu;scaleMenu.setLookAndFeel(&look);
            scaleMenu.addItem(11,"85%",true,curScale==1);
            scaleMenu.addItem(10,"100% (Default)",true,curScale==0);
            scaleMenu.addItem(12,"125%",true,curScale==2);
            juce::PopupMenu troubleshooting;troubleshooting.setLookAndFeel(&look);troubleshooting.addItem(1,"Copy diagnostics");troubleshooting.addItem(3,"Export diagnostics and logs...");
            juce::PopupMenu menu;menu.setLookAndFeel(&look);
            menu.addSubMenu("UI scale",scaleMenu);
            menu.addSubMenu("Troubleshooting",troubleshooting);
            menu.addItem(2,"Compatibility");menu.addItem(4,"Check for updates");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&more).withParentComponent(this),[safe](int result){
                if(!safe)return;
                if(result>=10&&result<=12){safe->p.uiScaleIndex.store(result-10);safe->applyUiScale();return;}
                if(result==1){juce::SystemClipboard::copyTextToClipboard(safe->p.diagnostics());safe->diagnosticsMessage="Diagnostics copied";safe->diagnosticsTicks=60;safe->repaint();}
                if(result==3)safe->exportDiagnostics();
                if(result==4){safe->p.updates.check(true);safe->checkingUpdate=true;safe->diagnosticsMessage="Checking for updates...";safe->diagnosticsTicks=100;}
                if(result==2)juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::InfoIcon,"SessionStream compatibility","Works with most DAWs that support VST3, and AU hosts on macOS.\n\nmacOS 13.5+: Apple Silicon, VST3 + AU\nWindows 11: Intel/AMD x64 + ARM64, VST3\n\nUse AU in Logic Pro. Pro Tools requires AAX, which is not included. Windows ARM64 uses an x64 streaming helper under emulation. Intel Macs and 32-bit DAWs are not supported.");
            });
        };
        p.controller->prepare();p.updates.check();setSize(860,510);applyUiScale();timerCallback();startTimerHz(20);
    }
    ~StreamEditor() override {p.signalCapture.active=false;stopTimer();setLookAndFeel(nullptr);}

    void mouseDown(const juce::MouseEvent& e) override {
        auto* target=e.originalComponent;
        if(target!=nullptr&&dynamic_cast<juce::TextEditor*>(target)==nullptr&&target->findParentComponentOfClass<juce::TextEditor>()==nullptr)juce::Component::unfocusAllComponents();
        // Click-to-reset held stereo peaks in the Audio Monitor meter zone
        if(juce::Rectangle<int>(24,392,216,64).contains(e.getPosition())){
            heldPeaks[0]=heldPeaks[1]=0.f;peakHoldTicks[0]=peakHoldTicks[1]=0;
            repaint(24,392,216,64);
        }
    }

    void resized() override {
        const bool signedIn=s.accountPhase=="signed-in";
        const bool pro=signedIn&&s.planKnown&&s.plan=="pro";
        layoutAccountButton();
        more.setBounds(806,20,38,28);
        sendMode.setBounds(342,20,86,28);
        receiveMode.setBounds(430,20,88,28);

        spectrum.setBounds(20,72,550,280);
        level.setBounds(257,386,90,78);
        localMute.setBounds(522,428,34,30);

        sessionPageButton.setBounds(602,100,64,30);
        setupButton.setBounds(pro?688:788,100,38,30);
        peopleButton.setBounds(734,100,92,30);
        invite.setBounds(602,164,224,34);
        copy.setBounds(602,208,180,36);qrButton.setBounds(790,208,36,36);
        includePasscode.setBounds(602,250,224,24);
        copyWithPasscode.setBounds(602,208,224,26);
        generate.setBounds(750,98,76,26);

        setupOverlay.setBounds(602,136,224,130);useDirect.setBounds(602,390,224,24);
        linkKind.setBounds(602,272,224,28);
        customName.setBounds(602,306,140,28);
        claimLink.setBounds(750,306,76,28);
        showHostName.setBounds(602,pro?340:282,224,22);
        usePasscode.setBounds(602,pro?366:308,224,22);
        passcode.setBounds(602,pro?390:332,224,28);

        listenerPanel.setBounds(602,136,224,272);

        const bool hasRxPass=receivePasscode.isVisible();
        receiveTarget.setBounds(602,146,224,30);
        receivePasscode.setBounds(602,182,224,28);
        const int rxTransportY=hasRxPass?230:198;
        rxLiveMode.setBounds(604,rxTransportY,108,24);
        rxPcmMode.setBounds(714,rxTransportY,110,24);
        const int rxBufY=(p.isReceiving()&&!(s.receivePhase=="error"||s.receivePhase=="passcode"||s.receivePhase=="denied"))?280:(rxTransportY+48);
        rxBuf40.setBounds(604,rxBufY,71,24);
        rxBuf90.setBounds(677,rxBufY,72,24);
        rxBuf200.setBounds(751,rxBufY,73,24);

        endButton.setBounds(652,430,42,38);
        toggle.setBounds(602,430,42,38);
        update.setBounds(584,526,134,30);
        ignoreUpdate.setBounds(726,526,118,30);
        qrOverlay.setBounds(getLocalBounds());linkProgress.setBounds(getLocalBounds());
        for(auto* field:{&invite,&passcode,&customName,&receiveTarget,&receivePasscode}){field->setBorder(juce::BorderSize<int>());field->setIndents(10,0);field->setJustification(juce::Justification::centredLeft);}
    }

    void paint(juce::Graphics& g) override {
        using namespace studio;
        const bool signedIn=s.accountPhase=="signed-in";
        const bool pro=signedIn&&s.planKnown&&s.plan=="pro";
        const bool receiving=pro&&p.isReceiveMode();
        const bool active=receiving?(p.isReceiving()&&s.receiving):(p.isSending()&&s.live);
        const auto ink=(s.warning||s.receivePhase=="denied")?warm:(active||s.receivePhase=="approval")?accent:muted;

        g.fillAll(background);
        auto label=[&](const juce::String& value,int x,int y,int w,int h,float size,juce::Colour colour,bool bold=false,juce::Justification just=juce::Justification::centredLeft){
            g.setFont(size>=16?headingFont(size):font(size,bold));
            g.setColour(colour);
            g.drawText(value,x,y,w,h,just);
        };
        auto insetTrack=[&](juce::Rectangle<float> area){
            g.setColour(inset);g.fillRoundedRectangle(area,6.f);
            g.setColour(line);g.drawRoundedRectangle(area.reduced(.5f),6.f,1.f);
        };

        // Top Header Bar
        if(logo)logo->drawWithin(g,{16,20,25,29},juce::RectanglePlacement::centred,1.f);
        g.setColour(text);g.setFont(headingFont(26.f,true).withExtraKerningFactor(-.04f));
        g.drawText("sessionstream",54,16,206,36,juce::Justification::centredLeft);
        juce::GlyphArrangement wordmark;wordmark.addLineOfText(headingFont(26.f,true).withExtraKerningFactor(-.04f),"sessionstream",0,0);
        label(UpdateChecker::currentVersion,54+juce::roundToInt(wordmark.getBoundingBox(0,-1,true).getRight())+8,29,44,18,10,muted);
        g.setColour(line);g.drawHorizontalLine(63,20.f,840.f);

        // Main Cards
        g.setColour(line);g.drawVerticalLine(584,76.f,468.f);g.drawHorizontalLine(362,20.f,570.f);

        // Right Card Live Status & Timer (Always visible — never hidden by pending listener requests)
        const auto stateText=s.ending?"Ending session..."
            :s.warning?"Check audio"
            :receiving?(s.receivePhase=="approval"?"Awaiting approval":s.receivePhase=="denied"?"Access declined":active?"Receiving":p.isReceiving()?"Connecting":"Ready to receive")
            :s.handoffReady?"Active on other track"
            :active?"Streaming"
            :p.isSending()?"Connecting"
            :sessionLatched?"Paused"
            :"Ready";
        g.setColour(ink);g.fillEllipse(603.f,79.5f,5.f,5.f);
        label(stateText,614,72,134,20,10.5f,ink,true);
        if(sessionLatched&&s.streamStartedAt>0&&!receiving){
            const auto seconds=juce::jmax<juce::int64>(0,(juce::Time::currentTimeMillis()-s.streamStartedAt)/1000);
            const auto duration=juce::String(seconds/3600).paddedLeft('0',2)+":"+juce::String((seconds/60)%60).paddedLeft('0',2)+":"+juce::String(seconds%60).paddedLeft('0',2);
            if(endConfirmTicks==0)label(duration,708,439,118,20,11.f,muted,false,juce::Justification::centredRight);
        }

        if(!receiving){g.setColour(line);g.drawHorizontalLine(129,602.f,826.f);}

        if(receiving){
            label("Receive session",602,98,146,26,16.5f,text);
            const bool rxFailed=s.receivePhase=="error"||s.receivePhase=="passcode"||s.receivePhase=="denied";
            const bool rxEditable=!p.isReceiving()||rxFailed;
            if(rxEditable){
                label("Host invite",602,128,224,16,10,muted);
                const int rxTransportY=receivePasscode.isVisible()?230:198;
                label("Transport",602,rxTransportY-17,224,15,10,muted);
                insetTrack({602.f,rxTransportY-2.f,224.f,28.f});
                label("Target buffer",602,rxTransportY+31,224,15,10,muted);
                insetTrack({602.f,rxTransportY+46.f,224.f,28.f});
                if(rxFailed&&s.receiveMessage.isNotEmpty()){
                    g.setColour(warm);g.setFont(font(10.5f));
                    g.drawFittedText(s.receiveMessage,602,rxTransportY+80,224,34,juce::Justification::topLeft,2);
                }else{
                    g.setColour(muted);g.setFont(font(10.5f));
                    g.drawFittedText("Replaces this track's audio input while connected.",602,rxTransportY+80,224,34,juce::Justification::topLeft,2);
                }
            }else{
                // Structured active Receive spec & status card
                juce::Rectangle<float> spec{602.f,138.f,224.f,112.f};
                insetTrack(spec);
                g.setColour(line);
                g.drawHorizontalLine(184,602.f,826.f);
                g.drawHorizontalLine(216,602.f,826.f);
                const auto headline=s.receivePhase=="approval"?juce::String("Waiting for host approval")
                    :s.receiving?juce::String("Receiving audio stream")
                    :s.receiveMessage.isNotEmpty()?s.receiveMessage:juce::String("Connecting to host...");
                label(headline,612,144,204,18,11.f,s.receivePhase=="approval"?accent:text,true);
                label(s.receivePhase=="approval"?"Audio starts automatically when accepted.":receiveTarget.getText(),612,162,204,16,9.5f,muted);
                label("Transport",612,188,80,22,10.f,muted);
                label(s.receiveTransport=="webrtc"?"Live WebRTC":"Lossless PCM",692,188,124,22,10.5f,text,true,juce::Justification::centredRight);
                label("Source",612,220,80,22,10.f,muted);
                label(s.receiving?streamformat::layout(s.receiveChannels)+juce::String::fromUTF8(" \xC2\xB7 Active"):juce::String("Waiting"),692,220,124,22,10.5f,s.receiving?accent:muted,true,juce::Justification::centredRight);
                label("Target buffer",602,262,224,15,10,muted);
                insetTrack({602.f,278.f,224.f,28.f});
                g.setColour(muted);g.setFont(font(10.5f));
                g.drawFittedText("Adjust buffer smoothly while listening.",602,316,224,32,juce::Justification::topLeft,2);
            }
        }else if(showingPeople){
            if(s.listenerMessage.isNotEmpty())label(s.listenerMessage,602,396,224,18,10,warm);
        }else if(showingSetup){

        }else{
            label("Listening link",602,142,224,16,11,muted);
            g.setColour(line);g.drawHorizontalLine(286,602.f,826.f);
            const auto quality=pro?p.streamQuality.load():1;
            label("Format",602,296,60,20,11,muted);
            label(streamformat::names[juce::jlimit(0,8,quality)],672,296,154,20,11,text,false,juce::Justification::centredRight);
            const bool cloud=s.hasSession?s.delivery=="cloud":p.controller->usesCloud();
            if(cloud&&pro&&(!s.canCloud&&!p.isSending()))label("Cloud hours unavailable",602,374,224,14,10.5f,muted);
            else if(cloud&&pro){
                const auto bits=streamformat::pcm(quality)?p.signalRate()*(pro?p.streamChannels.load():2)*(quality==6?16:quality==7?24:32):double(quality==0?510000:quality==2?96000:quality==3?128000:quality==4?192000:quality==5?256000:320000);
                label("Per listener-hour",602,380,90,18,9.5f,muted);
                label(juce::String(bits/320000.0,2)+" h / "+juce::String(bits*3600/8/1e9,3)+" GB",692,380,134,18,10.5f,text,false,juce::Justification::centredRight);
            }else label(streamformat::layout(pro?p.streamChannels.load():2),602,374,224,20,11,muted);
            if(!pro)label(juce::String(s.listeners)+((s.hasSession?s.delivery=="cloud":p.controller->usesCloud())?" Cloud":" / "+juce::String(s.listenerLimit)),750,72,76,20,10.5f,muted,false,juce::Justification::centredRight);
            label("Delivery",602,322,70,20,11,muted);label((s.hasSession?s.delivery=="cloud":p.controller->usesCloud())?"Cloud":"Direct",672,322,154,20,11,text,false,juce::Justification::centredRight);
            label("Encryption",602,348,80,20,11,muted);label((s.hasSession?s.encrypted:p.controller->encryptsAudio())?"End to end":"Connection only",692,348,134,20,11,text,false,juce::Justification::centredRight);
            if(endConfirmTicks>0)label("Confirm end",704,439,122,20,11,warm,true,juce::Justification::centredRight);
        }
        if(!showingSetup){g.setColour(line);g.drawHorizontalLine(416,602.f,826.f);}

        // Bottom-Left Audio Monitor Card (16, 362, 556, 110)
        // Zone 1: Stereo Meter + dB Scale + Limiter Indicator
        label(receiving?"Receive level":"Stream level",32,371,128,16,10.5f,muted,true);
        const bool limOn=limiterHoldTicks>0;
        g.setColour(limOn?warm:line);
        g.fillEllipse(179.f,376.5f,5.f,5.f);
        label("Limiter",188,371,48,16,9.5f,limOn?warm:muted.withAlpha(.7f));

        for(int ch=0;ch<2;++ch){
            const int y=399+ch*21;
            const float db=juce::Decibels::gainToDecibels(peaks[ch],-60.f);
            label(ch?"R":"L",32,y-4,14,16,9.5f,muted,true);
            for(int seg=0;seg<32;++seg){
                const bool lit=(db+60.f)/60.f>(seg+.5f)/32.f;
                g.setColour(lit?(seg>=29?warm:accent):line);
                g.fillRect(50+seg*4,y,2,9);
            }
            const auto held=juce::jlimit(0.f,1.f,(juce::Decibels::gainToDecibels(heldPeaks[ch],-60.f)+60.f)/60.f);
            if(held>0.f){g.setColour(text.withAlpha(.78f));g.fillRect(50+juce::roundToInt(held*126.f),y-1,1,11);}
            label(db<=-60.f?juce::String("-inf"):juce::String(db,1),184,y-5,52,18,10.5f,text,false,juce::Justification::centredRight);
        }
        // dB scale markers (-48, -24, -12, -6, 0)
        g.setFont(font(8.5f));g.setColour(muted.withAlpha(.68f));
        for(int mark:{-48,-24,-12,-6,0}){
            const int mx=50+juce::roundToInt((mark+60.f)/60.f*126.f);
            g.drawText(juce::String(mark),mx-10,441,20,12,juce::Justification::centred,false);
        }

        // Crisp 1px vertical zone dividers
        g.setColour(line);
        g.drawVerticalLine(246,374.f,458.f);
        g.drawVerticalLine(358,374.f,458.f);

        // Zone 2: Rotary Gain
        label(receiving?"Receive gain":"Stream gain",252,371,100,16,10.f,muted,false,juce::Justification::centred);

        // Zone 3: Short-Term Loudness + Relocated Monitor Mute
        label((receiving?s.receiveChannels:p.streamChannels.load())>2?"Short-term / front L-R":"Short-term",372,371,178,15,10.f,muted);
        const auto lufs=p.loudness.lufs();
        label(std::isfinite(lufs)?juce::String(lufs,1)+" LUFS":juce::String::fromUTF8("\xE2\x80\x94 LUFS"),372,389,116,24,16.5f,text);
        if(receiving){
            label(juce::String(p.receiveBufferMs())+" ms buf",490,392,66,18,10.5f,muted,false,juce::Justification::centredRight);
            label("DAW input",372,433,184,22,10.5f,muted);
        }else{
            label("Local audio",372,430,130,22,10.5f,muted);
        }

        // Bottom Status Bar
        if(diagnosticsTicks>0||s.warning||!s.ready){g.setColour(ink);g.fillEllipse(17.f,487.5f,4.5f,4.5f);}
        g.setFont(font(11));g.setColour(muted);
        if(diagnosticsTicks>0||s.warning||!s.ready)g.drawFittedText(diagnosticsTicks>0?diagnosticsMessage:s.message,29,477,810,26,juce::Justification::centredLeft,1);

        if(updateVisible){
            g.setColour(line);g.drawHorizontalLine(513,16.f,844.f);
            label(updateMessage,16,522,550,38,12,text,true);
        }
    }

private:
    StreamProcessor& p;studio::Look look;juce::TooltipWindow tooltips{this,450};SpectrumView spectrum;std::unique_ptr<juce::Drawable> logo;
    studio::ModernButton generate,copy,copyWithPasscode,qrButton,toggle,update,ignoreUpdate,more,accountButton,sendMode,receiveMode,claimLink,setupButton,localMute,sessionPageButton,endButton,peopleButton,rxLiveMode,rxPcmMode,rxBuf40,rxBuf90,rxBuf200;
    ListenerPanel listenerPanel;juce::ComboBox linkKind;juce::ToggleButton usePasscode,showHostName,includePasscode;juce::Slider level;
    juce::TextEditor invite,passcode,customName,receiveTarget,receivePasscode;studio::ModernButton useDirect;InviteOverlay qrOverlay;SessionSetup setupOverlay;LinkProgressOverlay linkProgress;
    std::vector<std::pair<juce::Component*,bool>> progressEnabledStates;bool cancellingLink=false;
    juce::String lastLayoutKey,lastPaintKey,lastFooter,lastUpdateFooter,latest,updateMessage,diagnosticsMessage,lastClaimedName;
    juce::int64 lastDurationTick=-1;StreamController::Status s;
    float peaks[2]{},heldPeaks[2]{};int peakHoldTicks[2]{};
    int copiedTicks=0,copiedPasscodeTicks=0,diagnosticsTicks=0,endConfirmTicks=0,limiterHoldTicks=0,appliedScale=-1;
    bool checkingUpdate=false,showingSetup=false,showingPeople=false,sessionLatched=false,dragging=false,updateVisible=false,nameDirty=false,wasSignedIn=false,inviteSettingsDirty=false,waitingInviteSettings=false;
    std::unique_ptr<juce::FileChooser> diagnosticsChooser;

    void applyUiScale(){
        const int idx=juce::jlimit(0,2,p.uiScaleIndex.load());
        if(idx==appliedScale)return;
        const bool initialDefault=(appliedScale==-1&&idx==0);
        appliedScale=idx;
        const float factor=idx==1?.85f:idx==2?1.25f:1.f;
        if(!initialDefault)setScaleFactor(factor);
    }

    bool validDraftName()const {
        const auto value=customName.getText().trim();
        return value.length()>=3&&value.length()<=32&&juce::CharacterFunctions::isLetter(value[0])&&!value.endsWithChar('-');
    }

    void exportDiagnostics(){
        if(diagnosticsChooser)return;
        const auto file=juce::File::getSpecialLocation(juce::File::userDocumentsDirectory).getChildFile("SessionStream-diagnostics.json");
        diagnosticsChooser=std::make_unique<juce::FileChooser>("Export diagnostics and logs",file,"*.json");
        const juce::Component::SafePointer<StreamEditor> safe(this);
        diagnosticsChooser->launchAsync(juce::FileBrowserComponent::saveMode|juce::FileBrowserComponent::canSelectFiles|juce::FileBrowserComponent::warnAboutOverwriting,[safe](const juce::FileChooser& chooser){
            if(!safe)return;
            const auto result=chooser.getResult();
            if(result!=juce::File{}){
                if(result.replaceWithText(safe->p.diagnostics())){safe->diagnosticsMessage="Diagnostics saved";safe->diagnosticsTicks=60;}
                else juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::WarningIcon,"Export failed","Could not write diagnostics. Choose another location.");
            }
            safe->diagnosticsChooser.reset();
        });
    }

    void layoutAccountButton(){
        juce::GlyphArrangement name;name.addLineOfText(studio::font(12.f,true),accountButton.getButtonText(),0,0);
        const bool hasBadge=s.accountPhase=="signed-in"&&s.planKnown&&!s.reconnectRequired;
        const int badgeExtra=hasBadge?42:0;
        const int width=juce::jlimit(76,268,juce::roundToInt(std::ceil(name.getBoundingBox(0,-1,true).getWidth()))+42+badgeExtra);
        accountButton.setBounds(798-width,20,width,28);
    }

    void refreshUpdate(){
        const auto u=p.updates.status();latest=u.latest;if(checkingUpdate&&u.checked){checkingUpdate=false;diagnosticsMessage=u.available?"Update available.":u.latest.isEmpty()?"Could not check for updates. Try again.":"SessionStream is up to date.";diagnosticsTicks=100;}const auto phase=s.updater["phase"].toString();
        const bool active=phase.isNotEmpty()&&phase!="idle";
        updateVisible=u.available||active;
        updateMessage=active?s.updater["message"].toString():"SessionStream "+latest+" is available";
        if(phase=="downloading")updateMessage="Downloading SessionStream "+s.updater["version"].toString()+" · "+juce::String(juce::jlimit(0,100,int(double(s.updater["progress"])*100)))+"%";
        update.setButtonText(phase=="ready"?"Install on close":phase=="waiting"?"Queued":phase=="downloading"?"Downloading...":phase=="applying"?"Installing...":phase=="complete"||phase=="cancelled"?"Done":phase=="error"?"Try again":"Update plugin");
        update.setTooltip(phase=="error"?updateMessage:phase=="ready"?"Updates after you close all DAWs. Your account and preferences are kept.":"Downloads and verifies the release without opening a browser.");
        update.setEnabled(phase!="downloading"&&phase!="waiting"&&phase!="applying");
        ignoreUpdate.setButtonText(phase=="downloading"||phase=="ready"||phase=="waiting"?"Cancel":"Not now");
        update.setVisible(updateVisible);ignoreUpdate.setVisible(updateVisible&&phase!="applying"&&phase!="complete"&&phase!="cancelled");
        const auto footer=phase+updateMessage+juce::String(int(updateVisible));if(footer!=lastUpdateFooter){lastUpdateFooter=footer;repaint(0,510,860,62);}
        const int height=510+(updateVisible?62:0);if(getHeight()!=height){setSize(860,height);resized();}
    }

    void timerCallback() override {
        for(const auto& state:progressEnabledStates)state.first->setEnabled(state.second);
        progressEnabledStates.clear();
        applyUiScale();
        if(diagnosticsTicks>0)--diagnosticsTicks;
        if(endConfirmTicks>0)--endConfirmTicks;
        s=p.controller->status();
        if(cancellingLink&&!s.generating&&!s.ending)cancellingLink=false;
        if(s.available&&s.accountPhase=="signed-out"&&p.isReceiveMode())p.setReceiveMode(false);
        refreshUpdate();
        if((s.link.isNotEmpty()||(!s.generating&&!waitingInviteSettings))&&invite.getText()!=s.link)invite.setText(s.link,false);
        if(s.inviteExpired&&!s.generating&&!waitingInviteSettings&&p.isSending())p.setSending(false);

        const bool previouslyHadSession=sessionLatched;
        if(s.hasSession){sessionLatched=true;p.streamQuality=s.streamQuality;p.streamChannels=s.streamChannels;}
        else if(s.available&&!s.generating&&!s.ending&&!p.isSending())sessionLatched=false;
        if(previouslyHadSession&&!sessionLatched&&!s.ending){passcode.clear();waitingInviteSettings=false;inviteSettingsDirty=false;}
        if(!sessionLatched)studio::syncToggleState(usePasscode,p.controller->requiresPasscode());
        const bool settingsEditable=!sessionLatched&&!p.isSending()&&!s.generating&&!s.ending;

        const bool signedIn=s.accountPhase=="signed-in";
        const bool pro=signedIn&&s.planKnown&&s.plan=="pro";
        accountButton.setButtonText(s.accountPhase=="restoring"?"Signing in...":s.accountPhase=="signing-in"?"Cancel sign-in":s.reconnectRequired?"Reconnect account":signedIn?(s.accountName.isNotEmpty()?s.accountName:"Account"):"Sign in");
        if(signedIn&&s.planKnown&&!s.reconnectRequired)accountButton.setBadge(pro?"PRO":"FREE",pro);
        else accountButton.setBadge({},false);
        accountButton.setIconOnly(false);
        accountButton.setTitle(accountButton.getButtonText());
        layoutAccountButton();
        accountButton.setEnabled(s.available&&s.accountPhase!="restoring");
        accountButton.setTooltip(signedIn?"Account & subscription":s.accountMessage.isNotEmpty()?s.accountMessage:s.accountConfigured?"Optional account sign-in":"Account sign-in is not configured yet.");

        if(s.available&&s.planKnown&&!pro&&p.isReceiveMode())p.setReceiveMode(false);
        if(!pro)showingPeople=false;
        const bool receiving=pro&&p.isReceiveMode();
        spectrum.setReceiving(receiving);const int sourceChannels=receiving?s.receiveChannels:pro?p.streamChannels.load():2;spectrum.setLayout(streamformat::layout(sourceChannels)+(sourceChannels>2?" / front L-R":""));
        if(!signedIn&&wasSignedIn){nameDirty=false;lastClaimedName.clear();customName.setText({},false);}wasSignedIn=signedIn;

        // Free plugin strictly hides Pro-only controls until planKnown confirms Pro
        sendMode.setVisible(pro);receiveMode.setVisible(pro);
        sendMode.setEnabled(!p.isReceiving());receiveMode.setEnabled(pro&&!p.isSending());
        receiveMode.setTooltip(pro?"Receive another SessionStream session in this track.":"");
        studio::syncToggleState(sendMode,!receiving);studio::syncToggleState(receiveMode,receiving);

        const bool receiveFailed=s.receivePhase=="error"||s.receivePhase=="passcode"||s.receivePhase=="denied";
        const bool receiveEditable=receiving&&(!p.isReceiving()||receiveFailed);
        receiveTarget.setVisible(receiveEditable);
        receivePasscode.setVisible(receiveEditable&&(receiveTarget.getText().isNotEmpty()||s.receivePhase=="passcode"));
        receiveTarget.setEnabled(receiveEditable);receivePasscode.setEnabled(receiveEditable);

        rxLiveMode.setVisible(receiveEditable);rxPcmMode.setVisible(receiveEditable);
        rxLiveMode.setEnabled(receiveEditable);rxPcmMode.setEnabled(receiveEditable);
        studio::syncToggleState(rxLiveMode,p.receiveLowLatency.load());
        studio::syncToggleState(rxPcmMode,!p.receiveLowLatency.load());

        const int bufIdx=p.receiveBufferIndex.load();
        for(int i=0;i<3;++i){
            auto* b=i==0?&rxBuf40:i==1?&rxBuf90:&rxBuf200;
            b->setVisible(receiving);
            b->setEnabled(receiving);
            studio::syncToggleState(*b,bufIdx==i);
        }

        linkKind.setVisible(showingSetup&&pro&&!receiving);
        const bool customSelected=pro&&p.controller->prefersCustomLink();
        linkKind.setSelectedId(customSelected?2:1,juce::dontSendNotification);
        linkKind.setItemEnabled(2,pro);
        linkKind.setEnabled(settingsEditable&&(signedIn||customSelected)&&!s.linkBusy);
        const bool custom=pro&&linkKind.getSelectedId()==2;
        customName.setVisible(showingSetup&&pro&&!receiving&&custom);claimLink.setVisible(showingSetup&&pro&&!receiving&&custom);
        customName.setEnabled(settingsEditable&&!s.linkBusy&&pro);claimLink.setEnabled(settingsEditable&&!s.linkBusy&&validDraftName()&&pro);
        if(customName.getText()==s.customName)nameDirty=false;
        if(s.customName!=lastClaimedName){lastClaimedName=s.customName;if(!nameDirty&&!customName.hasKeyboardFocus(true))customName.setText(s.customName,false);}
        claimLink.setTooltip(s.linkMessage);linkKind.setTooltip("Use a random link or your saved custom name.");
        claimLink.setButtonText(s.linkBusy?"Saving...":"Save name");
        level.setTooltip(receiving?"Adjusts received audio output in this DAW.":"Adjusts stream output only. DAW output is unchanged.");

        const bool customReady=!(pro&&s.linkBusy)&&(!custom||(pro&&!s.customName.isEmpty()&&!s.linkBusy&&s.linkAuthorized));
        const bool needsPlan=p.controller->listenerPreferences()!=0||p.controller->prefersCustomLink()||p.streamQuality.load()!=1||p.streamChannels.load()!=2;
        const bool planReady=(s.accountPhase!="signed-in"||s.planKnown)&&(!needsPlan||s.planKnown||s.accountPhase=="signed-out");
        const bool matchingBus=p.streamChannels.load()<=2||p.getMainBusNumInputChannels()==p.streamChannels.load();
        const bool canGenerate=matchingBus&&(!p.controller->usesCloud()||s.canCloud)&&settingsEditable&&p.isHostEnabled()&&s.ready&&customReady&&planReady;

        if(waitingInviteSettings&&!s.generating&&s.link.isNotEmpty()){waitingInviteSettings=false;inviteSettingsDirty=false;}
        if(sessionLatched&&!s.ending&&s.link.isNotEmpty()&&!inviteSettingsDirty&&!waitingInviteSettings)studio::syncToggleState(usePasscode,s.passcodeRequired);
        passcode.setTextToShowWhenEmpty(s.passcodeRequired&&!inviteSettingsDirty?"Existing passcode":"Enter passcode",studio::muted);
        const bool hasPasscode=!usePasscode.getToggleState()||passcode.getText().isNotEmpty();

        const bool onSessionTab=!receiving&&!showingSetup&&!showingPeople;
        const bool cloudBlocked=pro&&p.controller->usesCloud()&&!s.canCloud&&!p.isSending()&&!s.generating&&!s.ending;
        useDirect.setVisible(onSessionTab&&cloudBlocked);useDirect.setEnabled(cloudBlocked);
        copy.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);
        qrButton.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);
        const bool canCopyWithPass=onSessionTab&&s.link.isNotEmpty()&&s.passcodeRequired&&p.controller->activePasscode().isNotEmpty()&&!s.ending&&!s.generating;
        copyWithPasscode.setVisible(false);includePasscode.setVisible(canCopyWithPass);includePasscode.setEnabled(canCopyWithPass);
        copyWithPasscode.setEnabled(canCopyWithPass);

        const bool canHandoff=!receiving&&s.handoffReady&&p.isHostEnabled()&&!s.ending&&(s.streamChannels<=2||s.streamChannels==p.getMainBusNumInputChannels());
        toggle.setEnabled(!s.ending&&(p.isSending()||canHandoff||(matchingBus&&p.isHostEnabled()&&s.ready&&!s.generating&&customReady&&(!p.controller->usesCloud()||s.canCloud)&&((s.link.isNotEmpty()&&!inviteSettingsDirty)||(hasPasscode&&planReady)))));
        generate.setEnabled(canGenerate&&hasPasscode);
        usePasscode.setEnabled(settingsEditable&&!s.linkBusy);
        passcode.setEnabled(settingsEditable&&usePasscode.getToggleState());
        generate.setButtonText(s.generating?"Creating...":!s.ready?"Preparing...":s.link.isNotEmpty()?"New invite":"Create link");

        invite.setVisible(onSessionTab);copy.setVisible(onSessionTab);qrButton.setVisible(onSessionTab);
        generate.setVisible(false);
        usePasscode.setVisible(!receiving&&showingSetup);passcode.setVisible(!receiving&&showingSetup&&usePasscode.getToggleState());
        invite.setTooltip(s.passcodeRequired?"This link requires the passcode used when it was generated.":"Private listener link");
        qrOverlay.refresh(s.link);

        if(p.isSending()&&!p.isHostEnabled()&&p.shouldKeepSession())s.message="DAW render paused streaming. Audio resumes with playback.";
        toggle.setIcon(canHandoff?studio::ModernButton::Icon::swap:studio::ModernButton::Icon::play);
        toggle.setButtonText(s.ending?"Ending session...":p.isSending()?(s.live?"Pause streaming":"Starting... | Pause"):canHandoff?"Stream from this track":sessionLatched?"Resume streaming":"Start streaming");
        toggle.setColour(juce::TextButton::buttonColourId,p.isSending()?juce::Colour(0xff263129):studio::accent);
        toggle.setColour(juce::TextButton::textColourOffId,p.isSending()?studio::text:juce::Colour(0xff171e14));

        if(receiving){
            s.message=s.receiveMessage.isNotEmpty()?s.receiveMessage:"Ready to receive";
            s.warning=s.receivePhase=="error"||s.receivePhase=="passcode"||s.receivePhase=="denied";
            toggle.setIcon(studio::ModernButton::Icon::play);
            toggle.setEnabled(s.available&&(p.isReceiving()||receiveTarget.getText().isNotEmpty()));
            toggle.setButtonText(receiveFailed?"Retry connection":p.isReceiving()?"Disconnect":"Connect");
            toggle.setColour(juce::TextButton::buttonColourId,(p.isReceiving()&&!receiveFailed)?juce::Colour(0xff263129):studio::accent);
            toggle.setColour(juce::TextButton::textColourOffId,(p.isReceiving()&&!receiveFailed)?studio::text:juce::Colour(0xff171e14));
            generate.setVisible(p.isReceiving()&&!s.receiving);
            generate.setEnabled(p.isReceiving());
            generate.setButtonText("Cancel");
            generate.setIcon(studio::ModernButton::Icon::none);
        }else{
            generate.setIcon(studio::ModernButton::Icon::link);
        }

        int pendingRequests=0;
        if(pro&&s.available&&s.canManageListeners&&!receiving){
            if(const auto* listeners=s.listenerAccess["listeners"].getArray())
                for(const auto& listener:*listeners)
                    if(listener["status"].toString()=="pending")++pendingRequests;
        }
        peopleButton.setButtonText(juce::String(s.listeners)+((s.hasSession?s.delivery=="cloud":p.controller->usesCloud())?" Cloud":" / "+juce::String(s.listenerLimit)));
        peopleButton.setTitle("Listeners");
        peopleButton.setCountBadge(pendingRequests);
        peopleButton.setTooltip(pendingRequests>0?(juce::String(pendingRequests)+(pendingRequests==1?" pending listener request":" pending listener requests")):"Manage listeners");
        peopleButton.setVisible(pro&&!receiving);
        listenerPanel.setVisible(pro&&!receiving&&showingPeople);
        listenerPanel.configure(s.listenerAccess,pro,s.available&&s.canManageListeners,s.listenerSettingsAck,s.listenerMessage,s.hasSession?-1:p.controller->listenerPreferences());

        sessionPageButton.setVisible(!receiving);setupButton.setVisible(!receiving);setupButton.setEnabled(true);
        studio::syncToggleState(sessionPageButton,!showingSetup&&!showingPeople);
        studio::syncToggleState(peopleButton,showingPeople);
        studio::syncToggleState(setupButton,showingSetup);

        showHostName.setVisible(!receiving&&showingSetup&&signedIn);showHostName.setEnabled(settingsEditable);
        studio::syncToggleState(showHostName,p.controller->sharesHostName());
        if(!pro&&s.planKnown&&!sessionLatched&&!p.isSending()){p.streamQuality=1;p.streamChannels=2;p.controller->sessionSettings(1,0,2);}
        setupOverlay.setVisible(!receiving&&showingSetup);setupOverlay.configure(pro?p.streamQuality.load():1,pro?p.streamChannels.load():2,p.getMainBusNumInputChannels(),settingsEditable,pro);setupOverlay.configureDelivery(p.controller->usesCloud(),p.controller->encryptsAudio(),s.canCloud);

        endButton.setVisible(onSessionTab);
        endButton.setEnabled(!s.ending&&(sessionLatched||p.isSending()||s.generating));
        endButton.setButtonText(endConfirmTicks>0?"Confirm end":"End session");
        endButton.getProperties().set("role",endConfirmTicks>0?"danger":"secondary");

        toggle.setTitle(toggle.getButtonText());toggle.setTooltip(toggle.getButtonText());
        endButton.setTitle(endButton.getButtonText());
        localMute.setVisible(!receiving);
        localMute.setEnabled(p.isSending()&&!s.ending);
        localMute.setButtonText(p.localMuted()&&p.isSending()?"Unmute local audio":"Mute local audio");
        localMute.setTitle(localMute.getButtonText());localMute.setTooltip(localMute.getButtonText()+". Listeners still hear the stream.");
        studio::syncToggleState(localMute,p.localMuted()&&p.isSending());

        const auto layoutKey=juce::String(int(showingPeople))+juce::String(int(showingSetup))+juce::String(int(receiving))+juce::String(int(p.isReceiving()))+juce::String(int(receiveFailed))+juce::String(int(p.isSending()))+juce::String(int(signedIn))+juce::String(int(pro))+juce::String(int(custom))+juce::String(int(usePasscode.getToggleState()))+juce::String(int(updateVisible))+juce::String(int(receivePasscode.isVisible()))+juce::String(int(canCopyWithPass));
        if(layoutKey!=lastLayoutKey){lastLayoutKey=layoutKey;resized();repaint(584,64,260,408);}

        if(copiedTicks>0&&--copiedTicks==0)copy.setButtonText("Copy invite");
        if(copiedPasscodeTicks>0&&--copiedPasscodeTicks==0)copyWithPasscode.setButtonText("Copy with passcode");

        if(!dragging&&!level.hasKeyboardFocus(true)){
            const double maximum=receiving?6.0:12.0;
            if(level.getMaximum()!=maximum){level.setRange(-60,maximum,.1);level.setSkewFactorFromMidPoint(0.0);}
            level.setValue(juce::jmin(p.gainDb(),static_cast<float>(maximum)),juce::dontSendNotification);
        }

        const bool nowLimiting=receiving?p.receiver.limiterActive.load(std::memory_order_relaxed):p.sendLimiterActive.load(std::memory_order_relaxed);
        if(nowLimiting)limiterHoldTicks=8;
        else if(limiterHoldTicks>0)--limiterHoldTicks;

        peaks[0]=juce::jmax(p.transport.leftPeak.exchange(0),peaks[0]*.88f);peaks[1]=juce::jmax(p.transport.rightPeak.exchange(0),peaks[1]*.88f);
        for(int ch=0;ch<2;++ch){if(peaks[ch]>=heldPeaks[ch]){heldPeaks[ch]=peaks[ch];peakHoldTicks[ch]=30;}else if(peakHoldTicks[ch]>0)--peakHoldTicks[ch];else heldPeaks[ch]*=.94f;}

        for(auto* button:{&generate,&copy,&copyWithPasscode,&qrButton,&toggle,&update,&ignoreUpdate,&more,&accountButton,&sendMode,&receiveMode,&claimLink,&setupButton,&localMute,&sessionPageButton,&endButton,&peopleButton,&rxLiveMode,&rxPcmMode,&rxBuf40,&rxBuf90,&rxBuf200})button->refreshStyle();
        spectrum.update(p.signalCapture,p.signalRate());
        repaint(16,362,556,110);

        const auto timeTick=sessionLatched?juce::Time::currentTimeMillis()/1000:0;
        if(timeTick!=lastDurationTick){lastDurationTick=timeTick;repaint(704,430,126,38);}

        const auto paintKey=s.listenerMessage+juce::String(int(showingPeople))+juce::String(int(showingSetup))+juce::String(int(sessionLatched))+juce::String(int(endConfirmTicks>0))+juce::String(int(s.ending))+s.link+s.linkMessage+juce::String(int(s.live))+juce::String(int(s.warning))+juce::String(int(s.linkBusy))+juce::String(int(s.passcodeRequired))+customName.getText()+juce::String(int(validDraftName()))+s.receivePhase+s.receiveTransport+juce::String(int(s.handoffReady))+juce::String(pendingRequests)+"/"+juce::String(int(p.controller->usesCloud()))+"/"+juce::String(int(s.canCloud))+"/"+juce::String(p.streamQuality.load())+"/"+juce::String(p.streamChannels.load())+"/"+juce::String(p.signalRate())+"/"+juce::String(int(p.controller->encryptsAudio()));
        if(paintKey!=lastPaintKey){lastPaintKey=paintKey;repaint(584,64,260,408);}

        if(s.generating||cancellingLink){
            qrOverlay.setVisible(false);
            for(int i=0;i<getNumChildComponents();++i){auto* child=getChildComponent(i);if(child==&linkProgress)continue;progressEnabledStates.emplace_back(child,child->isEnabled());child->setEnabled(false);if(auto* button=dynamic_cast<studio::ModernButton*>(child))button->refreshStyle();}
            linkProgress.show(cancellingLink);
        }else linkProgress.hide();

        const auto footer=diagnosticsTicks>0?diagnosticsMessage:s.message;
        if(footer!=lastFooter){lastFooter=footer;repaint(16,477,830,28);}
    }
};

juce::AudioProcessorEditor* StreamProcessor::createEditor(){return new StreamEditor(*this);}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new StreamProcessor();}
