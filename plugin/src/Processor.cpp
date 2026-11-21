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
    return l.getMainInputChannelSet()==l.getMainOutputChannelSet()&&(l.getMainInputChannelSet()==juce::AudioChannelSet::stereo()||l.getMainInputChannelSet()==juce::AudioChannelSet::mono());
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
        receiver.render(b.getWritePointer(0),b.getNumChannels()>1?b.getWritePointer(1):nullptr,n,currentRate,first,step);
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
    if(!isReceiveMode()&&transport.enabled.load())transport.push(b.getReadPointer(0),b.getReadPointer(r),n,currentRate,first,step);else transport.resetPending();
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
    if(receiveLowLatency.load())flags|=32;
    flags|=((receiveBufferIndex.load()&3)<<6);
    flags|=((uiScaleIndex.load()&3)<<8);
    stream.writeInt(flags);
}

void StreamProcessor::setStateInformation(const void* data,int size) {
    // Keep legacy gain-only projects compatible. Save the mode, never a
    // connection activation, passcode, or account credential. Restoring the
    // same mode during render must leave the current session running.
    if(size!=4&&size!=9&&size!=17)return;
    juce::MemoryInputStream stream(data,static_cast<size_t>(size),false);
    const auto db=stream.readFloat();
    if(std::isfinite(db))setGainDb(juce::jlimit(-60.f,12.f,db));
    if(size>=9&&stream.readInt()==0x53535231){
        const bool mode=stream.readBool();
        if(mode!=isReceiveMode())setReceiveMode(mode);
        if(size==17){
            streamQuality=juce::jlimit(0,2,stream.readInt());
            const auto flags=stream.readInt();
            linkExpiryHours=0;
            receiveLowLatency.store((flags&32)!=0);
            setReceiveBufferIndex((flags>>6)&3);
            uiScaleIndex.store(juce::jlimit(0,2,(flags>>8)&3));
            if(controller){
                controller->restoreListenerPreferences(flags&3);
                controller->shareHostName((flags&4)!=0);
                controller->requirePasscode((flags&8)!=0);
                controller->preferCustomLink((flags&16)!=0);
            }
        }
    }
    if(controller)controller->sessionSettings(streamQuality,linkExpiryHours);
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

class StreamEditor final : public juce::AudioProcessorEditor,private juce::Timer {
public:
    explicit StreamEditor(StreamProcessor& processor):AudioProcessorEditor(processor),p(processor){
        setLookAndFeel(&look);
        p.signalCapture.drain([](SignalCapture::Frame){});p.signalCapture.active=true;
        addAndMakeVisible(spectrum);spectrum.setComponentID("live-spectrum");
        logo=juce::Drawable::createFromImageData(BinaryData::WebsiteMark_svg,BinaryData::WebsiteMark_svgSize);

        for(auto* b:{&sendMode,&receiveMode,&rxLiveMode,&rxPcmMode,&rxBuf40,&rxBuf90,&rxBuf200})b->getProperties().set("role","segment");
        more.getProperties().set("role","quiet");
        accountButton.getProperties().set("role","account");
        toggle.getProperties().set("role","primary");
        localMute.getProperties().set("role","secondary");
        addAndMakeVisible(localMute);
        addAndMakeVisible(setupButton);setupButton.getProperties().set("role","segment");setupButton.setComponentID("session-setup");setupButton.setButtonText("Settings");setupButton.setTitle("Session settings");setupButton.onClick=[this]{showingSetup=true;showingPeople=false;timerCallback();};
        addAndMakeVisible(sessionPageButton);sessionPageButton.getProperties().set("role","segment");sessionPageButton.setComponentID("session-page");sessionPageButton.setButtonText("Session");sessionPageButton.onClick=[this]{showingSetup=false;showingPeople=false;timerCallback();};
        addAndMakeVisible(peopleButton);peopleButton.setButtonText("Listeners");peopleButton.setComponentID("session-listeners");peopleButton.getProperties().set("role","segment");peopleButton.onClick=[this]{showingPeople=true;showingSetup=false;timerCallback();};

        addChildComponent(listenerPanel);listenerPanel.onAction=[this](juce::var command){p.controller->manageListeners(command);};
        addAndMakeVisible(endButton);endButton.setComponentID("end-session");endButton.getProperties().set("role","secondary");endButton.setTooltip("Disconnect everyone and invalidate this invite. Your custom name stays reserved.");
        endButton.onClick=[this]{
            if(s.ending||(!sessionLatched&&!p.isSending()&&!s.generating))return;
            if(endConfirmTicks==0){endConfirmTicks=100;timerCallback();return;}
            endConfirmTicks=0;p.setSending(false);p.setLocalMuted(false);p.controller->requirePasscode(false);p.controller->endSession();waitingInviteSettings=false;inviteSettingsDirty=true;
            studio::syncToggleState(usePasscode,false);passcode.clear();invite.clear();timerCallback();
        };
        localMute.setComponentID("mute-local");localMute.setIcon(studio::ModernButton::Icon::speaker);localMute.setTooltip("Silences this plugin's local DAW output while streaming. Listeners still hear the stream.");localMute.onClick=[this]{p.setLocalMuted(!p.localMuted());timerCallback();};
        setupOverlay.setComponentID("setup-panel");addChildComponent(setupOverlay);setupOverlay.onChange=[this](int q){if(sessionLatched||p.isSending()||s.generating||s.ending)return;if(q!=p.streamQuality){p.streamQuality=q;p.linkExpiryHours=0;p.controller->sessionSettings(q,0);inviteSettingsDirty=true;}};
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
        rxPcmMode.setButtonText("Lossless PCM");rxPcmMode.setTooltip("Bit-accurate uncompressed float32 stereo over tunnel.");
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
        generate.setButtonText("Create link");copy.setButtonText("Copy link");copyWithPasscode.setButtonText("Copy with passcode");toggle.setButtonText("Start streaming");
        qrButton.setButtonText("QR code");qrButton.onClick=[this]{qrOverlay.show(p.controller->status().link);};
        addAndMakeVisible(usePasscode);usePasscode.setButtonText("Passcode");usePasscode.setColour(juce::ToggleButton::textColourId,studio::muted);
        addAndMakeVisible(passcode);passcode.setPasswordCharacter(0x2022);passcode.setInputRestrictions(64);passcode.setTextToShowWhenEmpty("Passcode",studio::muted);passcode.setFont(studio::font(12));passcode.setIndents(10,7);passcode.setColour(juce::TextEditor::backgroundColourId,studio::inset);passcode.setColour(juce::TextEditor::textColourId,studio::text);passcode.setVisible(false);
        passcode.onTextChange=[this]{inviteSettingsDirty=true;};
        usePasscode.onClick=[this]{p.controller->requirePasscode(usePasscode.getToggleState());inviteSettingsDirty=true;passcode.setVisible(usePasscode.getToggleState());passcode.setEnabled(usePasscode.getToggleState());if(usePasscode.getToggleState())passcode.grabKeyboardFocus();else passcode.clear();};
        generate.onClick=[this]{if(p.isReceiveMode()){p.connectReceive(false);return;}const auto status=p.controller->status();if(!p.isHostEnabled()||!status.ready||status.generating||p.isSending())return;if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}waitingInviteSettings=true;generate.setEnabled(false);usePasscode.setEnabled(false);passcode.setEnabled(false);p.setSending(false);p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{},p.streamQuality,0);};
        copy.onClick=[this]{juce::SystemClipboard::copyTextToClipboard(p.controller->status().link);copy.setButtonText("Copied");copiedTicks=30;};
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
            if(status.handoffReady&&p.isHostEnabled()&&!status.ending){
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
            p.setSending(true);
        };
        addAndMakeVisible(invite);invite.setReadOnly(true);invite.setFont(studio::font(12));invite.setIndents(10,8);invite.setTextToShowWhenEmpty("Your private link appears here",studio::muted);invite.setColour(juce::TextEditor::backgroundColourId,studio::inset);invite.setColour(juce::TextEditor::textColourId,studio::muted);
        addAndMakeVisible(level);level.setTooltip("Adjusts stream output only. DAW output is unchanged. Double-click for 0 dB.");
        level.setRange(-60,12,.1);level.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);level.setTextBoxStyle(juce::Slider::TextBoxBelow,false,80,22);
        level.setSkewFactorFromMidPoint(0.0); // Places 0 dB unity exactly at 12 o'clock
        level.setTextValueSuffix(" dB");level.setValue(p.gainDb());level.setColour(juce::Slider::trackColourId,studio::accent);
        level.setDoubleClickReturnValue(true,0.f);
        level.onDragStart=[this]{dragging=true;};level.onDragEnd=[this]{dragging=false;};level.onValueChange=[this]{p.setGainDb(static_cast<float>(level.getValue()));};

        update.setButtonText("Get update");ignoreUpdate.setButtonText("Ignore for this session");
        update.onClick=[]{juce::URL(UpdateChecker::releasesURL).launchInDefaultBrowser();};
        ignoreUpdate.onClick=[this]{p.updates.ignoreForSession();refreshUpdate();};
        update.setVisible(false);ignoreUpdate.setVisible(false);
        addChildComponent(qrOverlay);

        addAndMakeVisible(accountButton);accountButton.setButtonText("Sign in");
        accountButton.setColour(juce::TextButton::buttonColourId,juce::Colour(0xff161e19));
        accountButton.setColour(juce::TextButton::textColourOffId,studio::text);
        accountButton.onClick=[this]{
            if(s.reconnectRequired&&s.accountPhase=="signed-in"){p.controller->reconnectAccount();return;}
            if(s.accountPhase!="signed-in"){p.controller->account(s.accountPhase!="signing-in");return;}
            juce::PopupMenu menu;menu.setLookAndFeel(&look);menu.addItem(1,"Sign out");menu.addItem(3,"Open account dashboard");menu.addItem(4,s.plan=="pro"?"Manage Pro subscription":"Upgrade to Pro");if(s.planKnown&&s.plan=="pro"&&s.customName.isNotEmpty())menu.addItem(2,"Release custom link");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&accountButton).withParentComponent(this),[safe](int result){if(safe&&result==1)safe->p.controller->account(false);if(safe&&result==2)safe->p.controller->links("release");if(safe&&result==3)juce::URL("https://sessionstream.app/dashboard/").launchInDefaultBrowser();if(safe&&result==4)juce::URL(safe->s.plan=="pro"?"https://sessionstream.app/dashboard/account/billing":"https://sessionstream.app/dashboard/billing/").launchInDefaultBrowser();});
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
            menu.addItem(2,"Compatibility");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&more).withParentComponent(this),[safe](int result){
                if(!safe)return;
                if(result>=10&&result<=12){safe->p.uiScaleIndex.store(result-10);safe->applyUiScale();return;}
                if(result==1){juce::SystemClipboard::copyTextToClipboard(safe->p.diagnostics());safe->diagnosticsMessage="Diagnostics copied";safe->diagnosticsTicks=60;safe->repaint();}
                if(result==3)safe->exportDiagnostics();
                if(result==2)juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::InfoIcon,"SessionStream compatibility","Works with most DAWs that support VST3, and AU hosts on macOS.\n\nmacOS 13.5+: Apple Silicon, VST3 + AU\nWindows 11: Intel/AMD x64 + ARM64, VST3\n\nUse AU in Logic Pro. Pro Tools requires AAX, which is not included. Windows ARM64 uses an x64 streaming helper under emulation. Intel Macs and 32-bit DAWs are not supported.");
            });
        };
        p.controller->prepare();p.updates.check();setSize(860,510);applyUiScale();timerCallback();startTimerHz(20);
    }
    ~StreamEditor() override {p.signalCapture.active=false;stopTimer();setLookAndFeel(nullptr);}

    void mouseDown(const juce::MouseEvent& e) override {
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

        spectrum.setBounds(16,64,556,286);
        level.setBounds(257,386,90,78);
        localMute.setBounds(372,430,184,28);

        if(pro){
            sessionPageButton.setBounds(604,100,66,26);
            setupButton.setBounds(672,100,68,26);
            peopleButton.setBounds(742,100,82,26);
        }else{
            sessionPageButton.setBounds(604,100,108,26);
            setupButton.setBounds(714,100,110,26);
            peopleButton.setBounds(742,100,82,26);
        }

        invite.setBounds(602,136,224,32);
        copy.setBounds(602,174,140,28);
        qrButton.setBounds(748,174,78,28);
        copyWithPasscode.setBounds(602,208,224,26);
        generate.setBounds(750,98,76,26);

        setupOverlay.setBounds(602,136,224,74);
        linkKind.setBounds(602,228,224,28);
        customName.setBounds(602,262,140,28);
        claimLink.setBounds(750,262,76,28);
        showHostName.setBounds(602,296,224,22);
        usePasscode.setBounds(602,322,224,22);
        passcode.setBounds(602,346,224,28);

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

        endButton.setBounds(602,378,224,28);
        toggle.setBounds(602,420,224,36);
        update.setBounds(584,526,108,30);
        ignoreUpdate.setBounds(700,526,144,30);
        qrOverlay.setBounds(getLocalBounds());
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
        auto card=[&](juce::Rectangle<float> area){
            g.setColour(panel);g.fillRoundedRectangle(area,7.f);
            g.setColour(line);g.drawRoundedRectangle(area.reduced(.5f),7.f,1.f);
        };
        auto insetTrack=[&](juce::Rectangle<float> area){
            g.setColour(inset);g.fillRoundedRectangle(area,6.f);
            g.setColour(line);g.drawRoundedRectangle(area.reduced(.5f),6.f,1.f);
        };

        // Top Header Bar
        if(logo)logo->drawWithin(g,{16,20,25,29},juce::RectanglePlacement::centred,1.f);
        g.setColour(text);g.setFont(headingFont(24.5f,true).withExtraKerningFactor(-.056f));
        g.drawText("sessionstream",50,16,162,36,juce::Justification::centredLeft);
        juce::GlyphArrangement wordmark;wordmark.addLineOfText(headingFont(24.5f,true).withExtraKerningFactor(-.056f),"sessionstream",0,0);
        label(UpdateChecker::currentVersion,50+juce::roundToInt(wordmark.getBoundingBox(0,-1,true).getRight())+8,29,44,18,10,muted);
        if(pro)insetTrack({340.f,18.f,180.f,32.f});

        // Main Cards
        card({584,64,260,408});
        card({16,362,556,110});

        // Right Card Live Status & Timer (Always visible — never hidden by pending listener requests)
        const auto stateText=s.ending?"Ending session..."
            :s.warning?"Check audio"
            :receiving?(s.receivePhase=="approval"?"Awaiting approval":s.receivePhase=="denied"?"Access declined":active?"Receiving":p.isReceiving()?"Connecting":"Ready to receive")
            :s.handoffReady?"Active on other track"
            :active?"Live session"
            :p.isSending()?"Connecting"
            :sessionLatched?"Paused"
            :"Ready";
        g.setColour(ink);g.fillEllipse(603.f,79.5f,5.f,5.f);
        label(stateText,614,72,134,20,10.5f,ink,true);
        if(sessionLatched&&s.streamStartedAt>0&&!receiving){
            const auto seconds=juce::jmax<juce::int64>(0,(juce::Time::currentTimeMillis()-s.streamStartedAt)/1000);
            const auto duration=juce::String(seconds/3600).paddedLeft('0',2)+":"+juce::String((seconds/60)%60).paddedLeft('0',2)+":"+juce::String(seconds%60).paddedLeft('0',2);
            label(duration,750,72,76,20,10.f,muted,false,juce::Justification::centredRight);
        }

        if(!receiving)insetTrack({602.f,98.f,224.f,30.f});

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
                    :s.receiving?juce::String("Receiving stereo stream")
                    :s.receiveMessage.isNotEmpty()?s.receiveMessage:juce::String("Connecting to host...");
                label(headline,612,144,204,18,11.f,s.receivePhase=="approval"?accent:text,true);
                label(s.receivePhase=="approval"?"Audio starts automatically when accepted.":receiveTarget.getText(),612,162,204,16,9.5f,muted);
                label("Transport",612,188,80,22,10.f,muted);
                label(s.receiveTransport=="webrtc"?"Live WebRTC":"Lossless PCM",692,188,124,22,10.5f,text,true,juce::Justification::centredRight);
                label("Source",612,220,80,22,10.f,muted);
                label(s.receiving?juce::String::fromUTF8("Stereo \xC2\xB7 Active"):juce::String("Waiting"),692,220,124,22,10.5f,s.receiving?accent:muted,true,juce::Justification::centredRight);
                label("Target buffer",602,262,224,15,10,muted);
                insetTrack({602.f,278.f,224.f,28.f});
                g.setColour(muted);g.setFont(font(10.5f));
                g.drawFittedText("Adjust buffer smoothly while listening.",602,316,224,32,juce::Justification::topLeft,2);
            }
        }else if(showingPeople){
            if(s.listenerMessage.isNotEmpty())label(s.listenerMessage,602,396,224,18,10,warm);
        }else if(showingSetup){
            if(pro)label("Link type",602,211,224,15,10,muted);
            const bool custom=pro&&linkKind.getSelectedId()==2;
            const auto hint=sessionLatched?juce::String("End this session to change settings."):custom&&customName.getText().isNotEmpty()&&!validDraftName()?juce::String::fromUTF8("3\xE2\x80\x93" "32 characters. Start with a letter; no trailing dash."):custom&&s.linkMessage.isNotEmpty()?s.linkMessage:custom&&s.customName.isEmpty()?juce::String("Choose and save a name to continue."):juce::String("Settings apply when you start a session.");
            g.setColour(!sessionLatched&&custom&&s.linkMessage.isNotEmpty()?warm:muted);g.setFont(font(10.5f));g.drawFittedText(hint,602,378,224,34,juce::Justification::topLeft,2);
        }else{
            // Structured Resend-style Session Spec Card (eliminating the empty void)
            const auto quality=pro?p.streamQuality.load():0;
            const bool showPassCopy=copyWithPasscode.isVisible();
            const int specY=showPassCopy?242:212;
            juce::Rectangle<float> spec{602.f,static_cast<float>(specY),224.f,84.f};
            insetTrack(spec);
            g.setColour(line);
            g.drawHorizontalLine(specY+28,602.f,826.f);
            g.drawHorizontalLine(specY+56,602.f,826.f);

            const juce::String codecValue=quality==0?"510 kbps Stereo":quality==1?"320 kbps Stereo":"96 kbps Stereo";
            const int accessBits=pro?p.controller->listenerPreferences():0;
            const bool hasPass=sessionLatched?s.passcodeRequired:usePasscode.getToggleState();
            const juce::String accessValue=(accessBits&2)?(hasPass?"Account + Passcode":"Signed-in only")
                :(accessBits&1)?(hasPass?"Approval + Passcode":"Approval required")
                :hasPass?"Passcode":"Private link";
            const juce::String linkValue=(pro&&p.controller->prefersCustomLink()&&s.customName.isNotEmpty())?("/"+s.customName):"Managed 6-digit";

            label("Codec",612,specY+3,64,22,10.f,muted);
            label(codecValue,678,specY+3,138,22,10.5f,text,true,juce::Justification::centredRight);
            label("Access",612,specY+31,64,22,10.f,muted);
            label(accessValue,678,specY+31,138,22,10.5f,hasPass||(accessBits!=0)?accent:text,true,juce::Justification::centredRight);
            label("Link",612,specY+59,64,22,10.f,muted);
            label(linkValue,678,specY+59,138,22,10.5f,text,false,juce::Justification::centredRight);

            const auto help=endConfirmTicks>0?juce::String("Click Confirm end to disconnect everyone and invalidate this invite.")
                :s.ending?juce::String("Closing this session...")
                :s.handoffReady?juce::String("Switch the live stream to this track without dropping your room or listeners.")
                :sessionLatched?(p.isSending()?juce::String("Pause keeps listeners connected. End session closes the invite."):juce::String("Audio is paused. Resume with the same invite and listeners."))
                :juce::String("Start a session, then copy the invite for your listeners.");
            juce::AttributedString paragraph(help);paragraph.setFont(font(10.5f));paragraph.setColour(endConfirmTicks>0?warm:muted);paragraph.setWordWrap(juce::AttributedString::WordWrap::byWord);
            paragraph.draw(g,{602.f,static_cast<float>(specY+92),224.f,42.f});
        }

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
        label("Short-term loudness",372,371,130,15,10.f,muted);
        const auto lufs=p.loudness.lufs();
        label(std::isfinite(lufs)?juce::String(lufs,1)+" LUFS":juce::String::fromUTF8("\xE2\x80\x94 LUFS"),372,389,116,24,16.5f,text);
        if(receiving){
            label(juce::String(p.receiveBufferMs())+" ms buf",490,392,66,18,10.5f,muted,false,juce::Justification::centredRight);
            label("Stereo DAW input",372,433,184,22,10.5f,muted);
        }else{
            label(juce::String(s.listeners)+" / "+juce::String(s.listenerLimit),490,392,66,18,10.5f,s.listeners>0?accent:muted,true,juce::Justification::centredRight);
        }

        // Bottom Status Bar
        g.setColour(ink);g.fillEllipse(17.f,487.5f,4.5f,4.5f);
        g.setFont(font(11));g.setColour(muted);
        g.drawFittedText(diagnosticsTicks>0?diagnosticsMessage:s.message,29,477,810,26,juce::Justification::centredLeft,1);

        if(updateVisible){
            g.setColour(line);g.drawHorizontalLine(513,16.f,844.f);
            label("SessionStream "+latest+" is available",16,526,550,27,12,text,true);
        }
    }

private:
    StreamProcessor& p;studio::Look look;SpectrumView spectrum;std::unique_ptr<juce::Drawable> logo;
    studio::ModernButton generate,copy,copyWithPasscode,qrButton,toggle,update,ignoreUpdate,more,accountButton,sendMode,receiveMode,claimLink,setupButton,localMute,sessionPageButton,endButton,peopleButton,rxLiveMode,rxPcmMode,rxBuf40,rxBuf90,rxBuf200;
    ListenerPanel listenerPanel;juce::ComboBox linkKind;juce::ToggleButton usePasscode,showHostName;juce::Slider level;
    juce::TextEditor invite,passcode,customName,receiveTarget,receivePasscode;InviteOverlay qrOverlay;SessionSetup setupOverlay;
    juce::String lastLayoutKey,lastPaintKey,lastFooter,latest,diagnosticsMessage,lastClaimedName;
    juce::int64 lastDurationTick=-1;StreamController::Status s;
    float peaks[2]{},heldPeaks[2]{};int peakHoldTicks[2]{};
    int copiedTicks=0,copiedPasscodeTicks=0,diagnosticsTicks=0,endConfirmTicks=0,limiterHoldTicks=0,appliedScale=-1;
    bool showingSetup=false,showingPeople=false,sessionLatched=false,dragging=false,updateVisible=false,nameDirty=false,wasSignedIn=false,inviteSettingsDirty=false,waitingInviteSettings=false;
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
        const auto u=p.updates.status();latest=u.latest;updateVisible=u.available;
        update.setVisible(updateVisible);ignoreUpdate.setVisible(updateVisible);
        const int height=510+(updateVisible?62:0);
        if(getHeight()!=height){setSize(860,height);resized();}
    }

    void timerCallback() override {
        applyUiScale();
        if(diagnosticsTicks>0)--diagnosticsTicks;
        if(endConfirmTicks>0)--endConfirmTicks;
        s=p.controller->status();
        if(s.available&&s.accountPhase=="signed-out"&&p.isReceiveMode())p.setReceiveMode(false);
        refreshUpdate();
        if((s.link.isNotEmpty()||(!s.generating&&!waitingInviteSettings))&&invite.getText()!=s.link)invite.setText(s.link,false);
        if(s.inviteExpired&&!s.generating&&!waitingInviteSettings&&p.isSending())p.setSending(false);

        const bool previouslyHadSession=sessionLatched;
        if(s.hasSession)sessionLatched=true;
        else if(s.available&&!s.generating&&!s.ending&&!p.isSending())sessionLatched=false;
        if(previouslyHadSession&&!sessionLatched&&!s.ending){passcode.clear();waitingInviteSettings=false;inviteSettingsDirty=false;}
        if(!sessionLatched)studio::syncToggleState(usePasscode,p.controller->requiresPasscode());
        const bool settingsEditable=!sessionLatched&&!p.isSending()&&!s.generating&&!s.ending;

        const bool signedIn=s.accountPhase=="signed-in";
        const bool pro=signedIn&&s.planKnown&&s.plan=="pro";
        accountButton.setButtonText(s.accountPhase=="restoring"?"Signing in...":s.accountPhase=="signing-in"?"Cancel sign-in":s.reconnectRequired?"Reconnect account":signedIn?(s.accountName.isNotEmpty()?s.accountName:"Account"):"Sign in");
        if(signedIn&&s.planKnown&&!s.reconnectRequired)accountButton.setBadge(pro?"PRO":"FREE",pro);
        else accountButton.setBadge({},false);
        layoutAccountButton();
        accountButton.setEnabled(s.available&&s.accountPhase!="restoring");
        accountButton.setTooltip(signedIn?"Account & subscription":s.accountMessage.isNotEmpty()?s.accountMessage:s.accountConfigured?"Optional account sign-in":"Account sign-in is not configured yet.");

        if(s.available&&s.planKnown&&!pro&&p.isReceiveMode())p.setReceiveMode(false);
        if(!pro)showingPeople=false;
        const bool receiving=pro&&p.isReceiveMode();
        spectrum.setReceiving(receiving);
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

        const bool customReady=!custom||(pro&&!s.customName.isEmpty()&&!s.linkBusy&&s.linkAuthorized);
        const bool needsPlan=p.controller->listenerPreferences()!=0||p.controller->prefersCustomLink()||p.streamQuality.load()!=0;
        const bool planReady=!needsPlan||s.planKnown||s.accountPhase=="signed-out";
        const bool canGenerate=settingsEditable&&p.isHostEnabled()&&s.ready&&customReady&&planReady;

        if(waitingInviteSettings&&!s.generating&&s.link.isNotEmpty()){waitingInviteSettings=false;inviteSettingsDirty=false;}
        if(sessionLatched&&!s.ending&&s.link.isNotEmpty()&&!inviteSettingsDirty&&!waitingInviteSettings)studio::syncToggleState(usePasscode,s.passcodeRequired);
        passcode.setTextToShowWhenEmpty(s.passcodeRequired&&!inviteSettingsDirty?"Existing passcode":"Enter passcode",studio::muted);
        const bool hasPasscode=!usePasscode.getToggleState()||passcode.getText().isNotEmpty();

        const bool onSessionTab=!receiving&&!showingSetup&&!showingPeople;
        copy.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);
        qrButton.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);
        const bool canCopyWithPass=onSessionTab&&s.link.isNotEmpty()&&s.passcodeRequired&&p.controller->activePasscode().isNotEmpty()&&!s.ending&&!s.generating;
        copyWithPasscode.setVisible(canCopyWithPass);
        copyWithPasscode.setEnabled(canCopyWithPass);

        const bool canHandoff=!receiving&&s.handoffReady&&p.isHostEnabled()&&!s.ending;
        toggle.setEnabled(!s.ending&&(p.isSending()||canHandoff||(p.isHostEnabled()&&s.ready&&!s.generating&&customReady&&((s.link.isNotEmpty()&&!inviteSettingsDirty)||(hasPasscode&&planReady)))));
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
        setupOverlay.setVisible(!receiving&&showingSetup);setupOverlay.configure(pro?p.streamQuality.load():0,settingsEditable,pro);

        endButton.setVisible(onSessionTab);
        endButton.setEnabled(!s.ending&&(sessionLatched||p.isSending()||s.generating));
        endButton.setButtonText(endConfirmTicks>0?"Confirm end":"End session");
        endButton.getProperties().set("role",endConfirmTicks>0?"danger":"secondary");

        localMute.setVisible(!receiving);
        localMute.setEnabled(p.isSending()&&!s.ending);
        localMute.setButtonText(p.localMuted()&&p.isSending()?"Unmute local audio":"Mute local audio");
        studio::syncToggleState(localMute,p.localMuted()&&p.isSending());

        const auto layoutKey=juce::String(int(showingPeople))+juce::String(int(showingSetup))+juce::String(int(receiving))+juce::String(int(p.isReceiving()))+juce::String(int(receiveFailed))+juce::String(int(p.isSending()))+juce::String(int(signedIn))+juce::String(int(pro))+juce::String(int(custom))+juce::String(int(usePasscode.getToggleState()))+juce::String(int(updateVisible))+juce::String(int(receivePasscode.isVisible()))+juce::String(int(canCopyWithPass));
        if(layoutKey!=lastLayoutKey){lastLayoutKey=layoutKey;resized();repaint(584,64,260,408);}

        if(copiedTicks>0&&--copiedTicks==0)copy.setButtonText("Copy link");
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
        if(timeTick!=lastDurationTick){lastDurationTick=timeTick;repaint(748,72,80,20);}

        const auto paintKey=s.listenerMessage+juce::String(int(showingPeople))+juce::String(int(showingSetup))+juce::String(int(sessionLatched))+juce::String(int(endConfirmTicks>0))+juce::String(int(s.ending))+s.link+s.linkMessage+juce::String(int(s.live))+juce::String(int(s.warning))+juce::String(int(s.linkBusy))+juce::String(int(s.passcodeRequired))+customName.getText()+juce::String(int(validDraftName()))+s.receivePhase+s.receiveTransport+juce::String(int(s.handoffReady))+juce::String(pendingRequests);
        if(paintKey!=lastPaintKey){lastPaintKey=paintKey;repaint(584,64,260,408);}

        const auto footer=diagnosticsTicks>0?diagnosticsMessage:s.message;
        if(footer!=lastFooter){lastFooter=footer;repaint(16,477,830,28);}
    }
};

juce::AudioProcessorEditor* StreamProcessor::createEditor(){return new StreamEditor(*this);}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new StreamProcessor();}
