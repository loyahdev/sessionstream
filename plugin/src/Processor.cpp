#include "Processor.h"
#include "InviteQR.h"
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
    data->setProperty("mode",isReceiveMode()?"receive":"send");data->setProperty("receivingRequested",isReceiving());data->setProperty("receivePhase",state.receivePhase);
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
StreamProcessor::StreamProcessor(UpdateChecker::Fetch reader,int streamPort) : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)), transport(streamPort),updates(std::move(reader)) {
    sendParameter=new juce::AudioParameterBool(juce::ParameterID("send",1),"Send audio",false);addParameter(sendParameter);
    gainParameter=new juce::AudioParameterFloat(juce::ParameterID("streamGain",1),"Stream output dB",juce::NormalisableRange<float>(-60.f,12.f,.1f),0.f);addParameter(gainParameter);
    bypassParameter=new juce::AudioParameterBool(juce::ParameterID("bypass",1),"Bypass",false);addParameter(bypassParameter);
    muteParameter=new juce::AudioParameterBool(juce::ParameterID("localMute",1),"Mute local monitor",false);addParameter(muteParameter);
    controller=std::make_unique<StreamController>(transport.getSourceId(),[this]{return isSending();},"http://127.0.0.1:8788",juce::File{},[this]{
        const bool active=isHostEnabled();
        if(!active)transport.enabled=false;
        return shouldKeepSession();
    },[this]{setSending(false);});
}
bool StreamProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    return l.getMainInputChannelSet()==l.getMainOutputChannelSet()&&(l.getMainInputChannelSet()==juce::AudioChannelSet::stereo()||l.getMainInputChannelSet()==juce::AudioChannelSet::mono());
}
void StreamProcessor::processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer&) {
    // Offline callbacks must never latch a disabled state into the next live
    // session. In particular, Live may pause before its first realtime block.
    if(isNonRealtime()){receiver.enabled=false;receiver.flush();if(isReceiveMode())b.clear();++offlineBlocks;transport.enabled=false;transport.resetPending();return;}
    hostActivity.block(bypassParameter->get());
    if(bypassParameter->get()){receiver.enabled=false;receiver.flush();transport.enabled=false;transport.resetPending();return;}
    juce::ScopedNoDenormals guard;transport.enabled.store(isSending()&&!isSuspended(),std::memory_order_relaxed);
    if(b.getNumChannels()<1||b.getNumSamples()<1)return;
    const int r=b.getNumChannels()>1?1:0,n=b.getNumSamples();
    gain.setTargetValue(juce::Decibels::decibelsToGain(gainParameter->get()));
    const float first=gain.getCurrentValue(),last=gain.skip(n),step=(last-first)/n;
    if(isReceiveMode()){
        transport.enabled=false;transport.resetPending();receiver.enabled=isReceiving()&&!isSuspended();
        receiver.render(b.getWritePointer(0),b.getNumChannels()>1?b.getWritePointer(1):nullptr,n,currentRate,first,step);
    }
    signalCapture.push(b.getReadPointer(0),b.getReadPointer(r),n,isReceiveMode()?1.f:first,isReceiveMode()?0.f:step);
    float lPeak=0,rPeak=0;
    for(int i=0;i<n;i++){const auto g=isReceiveMode()?1.f:first+step*i;lPeak=juce::jmax(lPeak,std::abs(b.getSample(0,i)*g));rPeak=juce::jmax(rPeak,std::abs(b.getSample(r,i)*g));}
    transport.leftPeak.store(juce::jmax(lPeak,transport.leftPeak.load()));transport.rightPeak.store(juce::jmax(rPeak,transport.rightPeak.load()));
    if(!isReceiveMode()&&transport.enabled.load())transport.push(b.getReadPointer(0),b.getReadPointer(r),n,currentRate,first,step);else transport.resetPending();
    localMonitor.setTargetValue(localMuted()&&isSending()&&!isReceiveMode()?0.f:1.f);
    const auto monitorFirst=localMonitor.getCurrentValue(),monitorLast=localMonitor.skip(n);
    b.applyGainRamp(0,n,monitorFirst,monitorLast);
}
void StreamProcessor::processBlockBypassed(juce::AudioBuffer<float>&,juce::MidiBuffer&) {
    if(!isNonRealtime())hostActivity.block(true);receiver.enabled=false;receiver.flush();transport.enabled=false;transport.resetPending();
}
void StreamProcessor::getStateInformation(juce::MemoryBlock& state) {
    juce::MemoryOutputStream stream(state,false);stream.writeFloat(gainDb());stream.writeInt(0x53535231);stream.writeBool(isReceiveMode());stream.writeInt(streamQuality.load());stream.writeInt(0);
}
void StreamProcessor::setStateInformation(const void* data,int size) {
    // Keep legacy gain-only projects compatible. Save the mode, never a
    // connection activation, passcode, or account credential. Restoring the
    // same mode during render must leave the current session running.
    if(size==4||size==9||size==17){
        juce::MemoryInputStream stream(data,static_cast<size_t>(size),false);const auto db=stream.readFloat();if(std::isfinite(db))setGainDb(juce::jlimit(-60.f,12.f,db));
        if(size>=9&&stream.readInt()==0x53535231){const bool mode=stream.readBool();if(mode!=isReceiveMode())setReceiveMode(mode);if(size==17){streamQuality=juce::jlimit(0,2,stream.readInt());(void)stream.readInt();linkExpiryHours=0;}}
        if(controller)controller->sessionSettings(streamQuality,linkExpiryHours);
    }
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
        p.signalCapture.drain([](SignalCapture::Frame){});p.signalCapture.active=true;addAndMakeVisible(spectrum);spectrum.setComponentID("live-spectrum");
        logo=juce::ImageCache::getFromMemory(BinaryData::SessionStreamLogo_png,BinaryData::SessionStreamLogo_pngSize);
        for(auto* b:{&sendMode,&receiveMode})b->getProperties().set("role","tab");
        for(auto* b:{&more,&accountButton})b->getProperties().set("role","quiet");
        toggle.getProperties().set("role","primary");
        for(auto* b:{&setupButton,&localMute}){addAndMakeVisible(b);b->getProperties().set("role","quiet");}
        setupButton.getProperties().set("role","tab");setupButton.setComponentID("session-setup");setupButton.setButtonText("Settings");setupButton.setTitle("Session settings");setupButton.onClick=[this]{showingSetup=true;timerCallback();};
        addAndMakeVisible(sessionPageButton);sessionPageButton.getProperties().set("role","tab");sessionPageButton.setComponentID("session-page");sessionPageButton.setButtonText("Session");sessionPageButton.onClick=[this]{showingSetup=false;timerCallback();};
        addAndMakeVisible(endButton);endButton.setComponentID("end-session");endButton.getProperties().set("role","quiet");endButton.setTooltip("Disconnect everyone and invalidate this invite. Your custom name stays reserved.");
        endButton.onClick=[this]{
            if(s.ending||(!sessionLatched&&!p.isSending()&&!s.generating))return;
            if(endConfirmTicks==0){endConfirmTicks=100;timerCallback();return;}
            endConfirmTicks=0;p.setSending(false);p.setLocalMuted(false);p.controller->endSession();waitingInviteSettings=false;inviteSettingsDirty=true;
            studio::syncToggleState(usePasscode,false);passcode.clear();invite.clear();timerCallback();
        };
        localMute.setComponentID("mute-local");localMute.setIcon(studio::ModernButton::Icon::speaker);localMute.setTooltip("Silences this plugin's local DAW output while streaming. Listeners still hear the stream.");localMute.onClick=[this]{p.setLocalMuted(!p.localMuted());timerCallback();};
        setupOverlay.setComponentID("setup-panel");addChildComponent(setupOverlay);setupOverlay.onChange=[this](int q){if(sessionLatched||p.isSending()||s.generating||s.ending)return;if(q!=p.streamQuality){p.streamQuality=q;p.linkExpiryHours=0;p.controller->sessionSettings(q,0);inviteSettingsDirty=true;}};
        copy.setIcon(studio::ModernButton::Icon::copy);qrButton.setIcon(studio::ModernButton::Icon::qr);
        generate.setIcon(studio::ModernButton::Icon::link);toggle.setIcon(studio::ModernButton::Icon::play);accountButton.setIcon(studio::ModernButton::Icon::account);
        const std::pair<juce::Component*,const char*> ids[]{
            {&generate,"new-link"},{&copy,"copy-link"},{&qrButton,"qr-code"},{&toggle,"stream-toggle"},
            {&linkKind,"link-kind"},{&customName,"custom-name"},{&claimLink,"save-name"},{&usePasscode,"use-passcode"},
            {&passcode,"session-passcode"},{&receiveTarget,"receive-target"},{&receivePasscode,"receive-passcode"},
            {&level,"stream-gain"},{&sendMode,"send-mode"},{&receiveMode,"receive-mode"},{&qrOverlay,"qr-overlay"},
            {&update,"get-update"},{&ignoreUpdate,"ignore-update"}};
        for(const auto& item:ids)item.first->setComponentID(item.second);
        customName.setTitle("Custom link name");passcode.setTitle("Session passcode");receiveTarget.setTitle("Host invite");receivePasscode.setTitle("Receive passcode");invite.setTitle("Session link");

        for(auto* b:{&generate,&copy,&qrButton,&toggle,&update,&ignoreUpdate,&sendMode,&receiveMode,&claimLink}){addAndMakeVisible(b);b->setColour(juce::TextButton::buttonColourId,juce::Colour(0xff303b37));b->setColour(juce::TextButton::textColourOffId,studio::text);}
        sendMode.setButtonText("Send");receiveMode.setButtonText("Receive");claimLink.setButtonText("Save name");
        sendMode.onClick=[this]{if(!p.isSending()&&!p.isReceiving()&&p.isReceiveMode()){p.setReceiveMode(false);timerCallback();}};receiveMode.onClick=[this]{if(!p.isSending()&&!p.isReceiving()&&!p.isReceiveMode()){p.setReceiveMode(true);timerCallback();}};
        addAndMakeVisible(linkKind);linkKind.addItem("Random code",1);linkKind.addItem("Custom link",2);linkKind.setSelectedId(1,juce::dontSendNotification);
        linkKind.onChange=[this]{inviteSettingsDirty=true;pendingLinkMode=linkKind.getSelectedId();p.controller->links("mode",pendingLinkMode==2?"custom":"random");linkKind.setEnabled(false);};
        for(auto* field:{&customName,&receiveTarget,&receivePasscode}){addAndMakeVisible(field);field->setFont(studio::font(12));field->setIndents(10,7);field->setColour(juce::TextEditor::backgroundColourId,studio::inset);field->setColour(juce::TextEditor::textColourId,studio::text);}
        customName.setTextToShowWhenEmpty("Choose a name",studio::muted);customName.onTextChange=[this]{nameDirty=customName.getText()!=s.customName;};customName.setInputRestrictions(32,"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-");customName.setTooltip("sessionstream.app/your-name — one name per account. Saving another name releases the previous one.");
        receiveTarget.setTextToShowWhenEmpty("Share code, custom name or full link",studio::muted);receiveTarget.setInputRestrictions(512);
        receivePasscode.setTextToShowWhenEmpty("Passcode (if needed)",studio::muted);receivePasscode.setPasswordCharacter(0x2022);receivePasscode.setInputRestrictions(64);
        claimLink.onClick=[this]{p.controller->links("claim",customName.getText());};
        customName.onReturnKey=[this]{if(claimLink.isEnabled())claimLink.triggerClick();};
        generate.setButtonText("Create link");copy.setButtonText("Copy link");toggle.setButtonText("Start streaming");
        qrButton.setButtonText("QR code");qrButton.onClick=[this]{qrOverlay.show(p.controller->status().link);};
        addAndMakeVisible(usePasscode);usePasscode.setButtonText("Passcode");usePasscode.setColour(juce::ToggleButton::textColourId,studio::muted);
        addAndMakeVisible(passcode);passcode.setPasswordCharacter(0x2022);passcode.setInputRestrictions(64);passcode.setTextToShowWhenEmpty("Passcode",studio::muted);passcode.setFont(studio::font(12));passcode.setIndents(10,7);passcode.setColour(juce::TextEditor::backgroundColourId,studio::inset);passcode.setColour(juce::TextEditor::textColourId,studio::text);passcode.setVisible(false);
        passcode.onTextChange=[this]{inviteSettingsDirty=true;};
        usePasscode.onClick=[this]{inviteSettingsDirty=true;passcode.setVisible(usePasscode.getToggleState());passcode.setEnabled(usePasscode.getToggleState());if(usePasscode.getToggleState())passcode.grabKeyboardFocus();else passcode.clear();};
        generate.onClick=[this]{if(p.isReceiveMode()){p.connectReceive(false);return;}const auto status=p.controller->status();if(!p.isHostEnabled()||!status.ready||status.generating||p.isSending())return;if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}waitingInviteSettings=true;generate.setEnabled(false);usePasscode.setEnabled(false);passcode.setEnabled(false);p.setSending(false);p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{},p.streamQuality,0);};
        copy.onClick=[this]{juce::SystemClipboard::copyTextToClipboard(p.controller->status().link);copy.setButtonText("Copied");copiedTicks=30;};
        toggle.onClick=[this]{
            if(p.isReceiveMode()){const auto rx=p.controller->status();const bool retry=rx.receivePhase=="error"||rx.receivePhase=="passcode";p.connectReceive(retry||!p.isReceiving(),receiveTarget.getText(),receivePasscode.getText());return;}

            const auto status=p.controller->status();
            if(p.isSending()){p.setSending(false);return;}
            if(!p.isHostEnabled()||!status.ready||status.generating||status.ending)return;
            if(status.link.isEmpty()||inviteSettingsDirty){
                waitingInviteSettings=true;
                if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}
                p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{},p.streamQuality,0);
            }
            p.setSending(true);
        };
        addAndMakeVisible(invite);invite.setReadOnly(true);invite.setFont(studio::font(12));invite.setIndents(10,8);invite.setTextToShowWhenEmpty("Your private link appears here",studio::muted);invite.setColour(juce::TextEditor::backgroundColourId,studio::inset);invite.setColour(juce::TextEditor::textColourId,studio::muted);
        addAndMakeVisible(level);level.setTooltip("Adjusts stream output only. DAW output is unchanged.");level.setRange(-60,12,.1);level.setSliderStyle(juce::Slider::RotaryHorizontalVerticalDrag);level.setTextBoxStyle(juce::Slider::TextBoxBelow,false,82,25);level.setSkewFactorFromMidPoint(-6);level.setTextValueSuffix(" dB");level.setValue(p.gainDb());level.setColour(juce::Slider::trackColourId,juce::Colour(0xffbaf77a));
        level.setDoubleClickReturnValue(true,0.f);
        level.onDragStart=[this]{dragging=true;};level.onDragEnd=[this]{dragging=false;};level.onValueChange=[this]{p.setGainDb(static_cast<float>(level.getValue()));};
        update.setButtonText("Get update");ignoreUpdate.setButtonText("Ignore for this session");
        update.onClick=[]{juce::URL(UpdateChecker::releasesURL).launchInDefaultBrowser();};
        ignoreUpdate.onClick=[this]{p.updates.ignoreForSession();refreshUpdate();};
        update.setVisible(false);ignoreUpdate.setVisible(false);
        addChildComponent(qrOverlay);
        addAndMakeVisible(accountButton);accountButton.setButtonText("Sign in");
        accountButton.setColour(juce::TextButton::buttonColourId,juce::Colours::transparentBlack);
        accountButton.setColour(juce::TextButton::textColourOffId,studio::muted);
        accountButton.onClick=[this]{
            if(s.reconnectRequired){p.controller->reconnectAccount();return;}
            if(s.accountPhase!="signed-in"){p.controller->account(s.accountPhase!="signing-in");return;}
            juce::PopupMenu menu;menu.setLookAndFeel(&look);menu.addItem(1,"Sign out");if(s.customName.isNotEmpty())menu.addItem(2,"Release custom link");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&accountButton).withParentComponent(this),[safe](int result){if(safe&&result==1)safe->p.controller->account(false);if(safe&&result==2)safe->p.controller->links("release");});
        };
        addAndMakeVisible(more);more.setButtonText("...");more.setTooltip("More options");more.setTitle("More options");
        more.setColour(juce::TextButton::buttonColourId,juce::Colours::transparentBlack);more.setColour(juce::TextButton::textColourOffId,studio::muted);
        more.onClick=[this]{
            juce::PopupMenu troubleshooting;troubleshooting.setLookAndFeel(&look);troubleshooting.addItem(1,"Copy diagnostics");troubleshooting.addItem(3,"Export diagnostics and logs...");
            juce::PopupMenu menu;menu.setLookAndFeel(&look);menu.addSubMenu("Troubleshooting",troubleshooting);menu.addItem(2,"Compatibility");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&more).withParentComponent(this),[safe](int result){
                if(!safe)return;
                if(result==1){juce::SystemClipboard::copyTextToClipboard(safe->p.diagnostics());safe->diagnosticsMessage="Diagnostics copied";safe->diagnosticsTicks=60;safe->repaint();}
                if(result==3)safe->exportDiagnostics();
                if(result==2)juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::InfoIcon,"SessionStream compatibility","Works with most DAWs that support VST3, and AU hosts on macOS.\n\nmacOS 13.5+: Apple Silicon, VST3 + AU\nWindows 11: Intel/AMD x64 + ARM64, VST3\n\nUse AU in Logic Pro. Pro Tools requires AAX, which is not included. Windows ARM64 uses an x64 streaming helper under emulation. Intel Macs and 32-bit DAWs are not supported.");
            });
        };
        p.controller->prepare();p.updates.check();setSize(860,510);timerCallback();startTimerHz(20);
    }
    ~StreamEditor() override {p.signalCapture.active=false;stopTimer();setLookAndFeel(nullptr);}
    void resized() override {
        accountButton.setBounds(628,19,166,28);more.setBounds(806,19,38,28);
        sendMode.setBounds(321,19,82,30);receiveMode.setBounds(407,19,88,30);
        spectrum.setBounds(16,64,556,286);level.setBounds(254,385,90,82);
        invite.setBounds(602,132,224,32);copy.setBounds(602,172,138,30);qrButton.setBounds(748,172,78,30);
        generate.setBounds(730,94,96,28);
        linkKind.setBounds(602,230,224,28);customName.setBounds(602,266,140,28);claimLink.setBounds(750,266,76,28);
        usePasscode.setBounds(602,308,224,24);passcode.setBounds(602,338,224,28);
        receiveTarget.setBounds(602,146,224,32);receivePasscode.setBounds(602,216,224,30);
        toggle.setBounds(602,420,224,36);endButton.setBounds(602,378,224,28);
        update.setBounds(584,526,108,30);ignoreUpdate.setBounds(700,526,144,30);
        sessionPageButton.setBounds(602,100,108,28);setupButton.setBounds(718,100,108,28);localMute.setBounds(602,478,224,24);
        setupOverlay.setBounds(602,136,224,76);qrOverlay.setBounds(getLocalBounds());
    }
    void paint(juce::Graphics& g) override {
        using namespace studio;
        const bool receiving=s.accountPhase=="signed-in"&&p.isReceiveMode(),active=receiving?(p.isReceiving()&&s.receiving):(p.isSending()&&s.live);
        const auto ink=s.warning?warm:active?accent:muted;
        g.fillAll(background);
        auto label=[&](const juce::String& value,int x,int y,int w,int h,float size,juce::Colour colour,bool bold=false){g.setFont(font(size,bold));g.setColour(colour);g.drawText(value,x,y,w,h,juce::Justification::centredLeft);};
        auto card=[&](juce::Rectangle<float> area){g.setColour(panel);g.fillRoundedRectangle(area,6);};
        g.drawImageWithin(logo,16,22,195,30,juce::RectanglePlacement(juce::RectanglePlacement::xLeft|juce::RectanglePlacement::yMid));
        label(UpdateChecker::currentVersion,221,27,42,18,10,muted);
        card({584,64,260,408});card({16,362,556,110});
        g.setColour(ink);g.fillEllipse(603,80,5,5);
        const auto state=s.ending?"Ending session...":s.warning?"Check audio":active?(receiving?"Receiving":"Live session"):p.isSending()||p.isReceiving()?"Connecting":sessionLatched&&!receiving?"Paused":"Ready";
        label(state,615,72,122,20,10,ink);
        if(sessionLatched&&s.streamStartedAt>0){const auto seconds=juce::jmax<juce::int64>(0,(juce::Time::currentTimeMillis()-s.streamStartedAt)/1000);const auto duration=juce::String(seconds/3600).paddedLeft('0',2)+":"+juce::String((seconds/60)%60).paddedLeft('0',2)+":"+juce::String(seconds%60).paddedLeft('0',2);label(duration,748,72,78,20,10,muted);}
        if(receiving){
            label("Receive session",602,100,224,26,17,text);
            label("Host invite",602,126,224,16,10,muted);label("Passcode (optional)",602,196,224,16,10,muted);
            g.setColour(muted);g.setFont(font(11));g.drawFittedText("Received audio replaces this track's input.",602,276,224,38,juce::Justification::topLeft,2);
        }else if(showingSetup){
            label(s.accountPhase=="signed-in"?"Link type":"Random code",602,212,224,16,10,muted);
            if(s.accountPhase!="signed-in")label("Sign in for a custom name.",602,238,224,28,11,muted);
            const bool custom=linkKind.getSelectedId()==2;
            const auto hint=sessionLatched?juce::String("End this session to change settings."):custom&&customName.getText().isNotEmpty()&&!validDraftName()?juce::String("3–32 characters. Start with a letter; no trailing dash."):custom&&s.linkMessage.isNotEmpty()?s.linkMessage:custom&&s.customName.isEmpty()?juce::String("Choose and save a name to continue."):juce::String("Settings apply when you start a session.");
            g.setColour(!sessionLatched&&custom&&s.linkMessage.isNotEmpty()?warm:muted);g.setFont(font(11));g.drawFittedText(hint,602,373,224,36,juce::Justification::topLeft,2);
        }else{
            label(p.streamQuality==0?"Studio quality / Stereo":p.streamQuality==1?"Balanced quality / Stereo":"Phone quality / Stereo",602,228,224,22,11,text);
            label(s.passcodeRequired?"Passcode protected":"Private invite",602,253,224,22,11,muted);
            const auto help=endConfirmTicks>0?juce::String("Click Confirm end to disconnect everyone and invalidate this invite."):s.ending?juce::String("Closing this session..."):sessionLatched?(p.isSending()?juce::String("Pause keeps listeners connected. End session closes the invite."):juce::String("Audio is paused. Resume with the same invite and listeners.")):juce::String("Start a session, then copy the invite for your listeners.");
            juce::AttributedString paragraph(help);paragraph.setFont(font(11));paragraph.setColour(endConfirmTicks>0?warm:muted);paragraph.setWordWrap(juce::AttributedString::WordWrap::byWord);paragraph.draw(g,{602,292,224,58});
        }
        label(receiving?"Receive level":"Stream level",34,374,200,18,11,muted);
        for(int ch=0;ch<2;++ch){const int y=406+ch*26;const float db=juce::Decibels::gainToDecibels(peaks[ch],-60.f);label(ch?"R":"L",34,y-3,15,18,10,muted,true);
            for(int seg=0;seg<32;++seg){const bool lit=(db+60)/60.f>(seg+.5f)/32;g.setColour(lit?(seg>=31?warm:accent):line);g.fillRect(55+seg*4,y,2,10);}
            const auto held=juce::jlimit(0.f,1.f,(juce::Decibels::gainToDecibels(heldPeaks[ch],-60.f)+60)/60.f);if(held>0){g.setColour(text.withAlpha(.7f));g.fillRect(55+juce::roundToInt(held*126),y-1,1,12);}
            label(db<=-60?juce::String("-inf"):juce::String(db,1),192,y-5,43,20,11,text);
        }
        g.setColour(line);g.drawVerticalLine(242,380,454);g.drawVerticalLine(356,380,454);
        label(receiving?"Receive gain":"Stream gain",259,370,96,16,10,muted);
        label("Output ceiling",374,375,180,18,10,muted);label("-1.0 dBFS",374,397,180,25,17,text);
        label(receiving?"Stereo receive":juce::String(s.listeners)+(s.listeners==1?" listener":" listeners"),374,435,180,23,11,text);
        g.setColour(ink);g.fillEllipse(17,487,4,4);g.setFont(font(11));g.setColour(muted);g.drawFittedText(diagnosticsTicks>0?diagnosticsMessage:s.message,30,477,540,26,juce::Justification::centredLeft,2);
        if(updateVisible){g.setColour(line);g.drawHorizontalLine(513,16.f,844.f);label("SessionStream "+latest+" is available",16,526,550,27,12,text,true);}
    }

private:
    StreamProcessor& p;studio::Look look;SpectrumView spectrum;juce::Image logo;studio::ModernButton generate,copy,qrButton,toggle,update,ignoreUpdate,more,accountButton,sendMode,receiveMode,claimLink,setupButton,localMute,sessionPageButton,endButton;juce::ComboBox linkKind;juce::ToggleButton usePasscode;juce::Slider level;juce::TextEditor invite,passcode,customName,receiveTarget,receivePasscode;InviteOverlay qrOverlay;SessionSetup setupOverlay;juce::String lastLayoutKey,lastPaintKey,lastFooter;juce::int64 lastDurationTick=-1;StreamController::Status s;float peaks[2]{},heldPeaks[2]{};int peakHoldTicks[2]{};int copiedTicks=0,diagnosticsTicks=0,endConfirmTicks=0;bool showingSetup=false,sessionLatched=false,dragging=false,updateVisible=false,nameDirty=false,wasSignedIn=false,inviteSettingsDirty=false,waitingInviteSettings=false;int pendingLinkMode=0;juce::String latest,diagnosticsMessage,lastClaimedName;std::unique_ptr<juce::FileChooser> diagnosticsChooser;
    bool validDraftName()const {
        const auto value=customName.getText().trim();
        return value.length()>=3&&value.length()<=32&&juce::CharacterFunctions::isLetter(value[0])&&!value.endsWithChar('-');
    }
    int passcodeY()const {
        const int settingsY=218;
        if(s.accountPhase!="signed-in")return settingsY+30;
        return settingsY+96;
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
    void refreshUpdate(){const auto u=p.updates.status();latest=u.latest;updateVisible=u.available;update.setVisible(updateVisible);ignoreUpdate.setVisible(updateVisible);const int height=510+(updateVisible?62:0);if(getHeight()!=height){setSize(860,height);resized();}}

    void timerCallback() override {
        if(diagnosticsTicks>0)--diagnosticsTicks;if(endConfirmTicks>0)--endConfirmTicks;
        s=p.controller->status();if(s.available&&s.accountPhase=="signed-out"&&p.isReceiveMode())p.setReceiveMode(false);refreshUpdate();if((s.link.isNotEmpty()||(!s.generating&&!waitingInviteSettings))&&invite.getText()!=s.link)invite.setText(s.link,false);
        if(s.inviteExpired&&!s.generating&&!waitingInviteSettings&&p.isSending())p.setSending(false);
        const bool previouslyHadSession=sessionLatched;
        if(s.hasSession)sessionLatched=true;
        else if(s.available&&!s.generating&&!s.ending&&!p.isSending())sessionLatched=false;
        if(previouslyHadSession&&!sessionLatched&&!s.ending){studio::syncToggleState(usePasscode,false);passcode.clear();waitingInviteSettings=false;inviteSettingsDirty=false;}
        const bool settingsEditable=!sessionLatched&&!p.isSending()&&!s.generating&&!s.ending;
        accountButton.setButtonText(s.reconnectRequired?"Reconnect account":s.accountPhase=="signed-in"?s.accountName:s.accountPhase=="restoring"?"Signing in...":s.accountPhase=="signing-in"?"Cancel sign-in":"Sign in");
        accountButton.setEnabled(s.available&&s.accountPhase!="restoring");
        accountButton.setTooltip(s.accountPhase=="signed-in"?"Sign out":s.accountMessage.isNotEmpty()?s.accountMessage:s.accountConfigured?"Optional account sign-in":"Account sign-in is not configured yet.");
        const bool signedIn=s.accountPhase=="signed-in",receiving=signedIn&&p.isReceiveMode();
        if(!signedIn&&wasSignedIn){nameDirty=false;pendingLinkMode=0;lastClaimedName.clear();customName.setText({},false);}wasSignedIn=signedIn;
        sendMode.setVisible(signedIn);receiveMode.setVisible(signedIn);sendMode.setEnabled(!p.isReceiving());receiveMode.setEnabled(signedIn&&!p.isSending());receiveMode.setTooltip(signedIn?"Receive another SessionStream session in this track.":"Sign in to receive audio in the plugin.");
        studio::syncToggleState(sendMode,!receiving);studio::syncToggleState(receiveMode,receiving);
        for(auto* component:std::initializer_list<juce::Component*>{&generate,&copy,&qrButton,&invite,&usePasscode})component->setVisible(!receiving);
        const bool receiveFailed=s.receivePhase=="error"||s.receivePhase=="passcode";
        const bool receiveEditable=receiving&&(!p.isReceiving()||receiveFailed);
        receiveTarget.setVisible(receiveEditable);receivePasscode.setVisible(receiveEditable&&receiveTarget.getText().isNotEmpty());
        receiveTarget.setEnabled(receiveEditable);receivePasscode.setEnabled(receiveEditable);
        sendMode.setColour(juce::TextButton::buttonColourId,!receiving?juce::Colour(0xff344139):studio::inset);receiveMode.setColour(juce::TextButton::buttonColourId,receiving?juce::Colour(0xff344139):studio::inset);
        linkKind.setVisible(showingSetup&&signedIn&&!receiving);
        const int acknowledgedMode=s.linkMode=="custom"?2:1;if(pendingLinkMode&&(pendingLinkMode==acknowledgedMode||(!s.linkBusy&&s.linkMessage.isNotEmpty())))pendingLinkMode=0;
        linkKind.setItemEnabled(2,signedIn);if(!pendingLinkMode)linkKind.setSelectedId(acknowledgedMode,juce::dontSendNotification);linkKind.setEnabled(settingsEditable&&signedIn&&!s.linkBusy&&!pendingLinkMode);
        const bool custom=linkKind.getSelectedId()==2;
        customName.setVisible(showingSetup&&signedIn&&!receiving&&custom);claimLink.setVisible(showingSetup&&signedIn&&!receiving&&custom);
        customName.setEnabled(settingsEditable&&!s.linkBusy);claimLink.setEnabled(settingsEditable&&!pendingLinkMode&&!s.linkBusy&&validDraftName()&&signedIn);
        if(customName.getText()==s.customName)nameDirty=false;
        if(s.customName!=lastClaimedName){lastClaimedName=s.customName;if(!nameDirty&&!customName.hasKeyboardFocus(true))customName.setText(s.customName,false);}
        claimLink.setTooltip(s.linkMessage);linkKind.setTooltip(s.accountPhase=="signed-in"?"Use a random link or your saved custom name.":"Sign in to reserve a custom name. Random links work without an account.");
        claimLink.setButtonText(s.linkBusy?"Saving...":"Save name");
        level.setTooltip(receiving?"Adjusts received audio output in this DAW.":"Adjusts stream output only. DAW output is unchanged.");
        const bool customReady=!custom||(!s.customName.isEmpty()&&!s.linkBusy&&s.linkAuthorized);
        const bool canGenerate=settingsEditable&&p.isHostEnabled()&&s.ready&&customReady;
        if(waitingInviteSettings&&!s.generating&&s.link.isNotEmpty()){waitingInviteSettings=false;inviteSettingsDirty=false;}
        if(sessionLatched&&!s.ending&&s.link.isNotEmpty()&&!inviteSettingsDirty&&!waitingInviteSettings)studio::syncToggleState(usePasscode,s.passcodeRequired);
        passcode.setTextToShowWhenEmpty(s.passcodeRequired&&!inviteSettingsDirty?"Existing passcode":"Enter passcode",studio::muted);
        const bool hasPasscode=!usePasscode.getToggleState()||passcode.getText().isNotEmpty();
        copy.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);qrButton.setEnabled(s.link.isNotEmpty()&&!s.ending&&!s.generating);toggle.setEnabled(!s.ending&&(p.isSending()||(p.isHostEnabled()&&s.ready&&!s.generating&&customReady&&((s.link.isNotEmpty()&&!inviteSettingsDirty)||hasPasscode))));generate.setEnabled(canGenerate&&hasPasscode);usePasscode.setEnabled(settingsEditable&&!s.linkBusy);passcode.setEnabled(settingsEditable&&usePasscode.getToggleState());generate.setButtonText(s.generating?"Creating...":!s.ready?"Preparing...":s.link.isNotEmpty()?"New invite":"Create link");
        invite.setVisible(!receiving&&!showingSetup);copy.setVisible(!receiving&&!showingSetup);qrButton.setVisible(!receiving&&!showingSetup);
        generate.setVisible(false);
        usePasscode.setVisible(!receiving&&showingSetup);passcode.setVisible(!receiving&&showingSetup&&usePasscode.getToggleState());
        invite.setTooltip(s.passcodeRequired?"This link requires the passcode used when it was generated.":"Private listener link");qrOverlay.refresh(s.link);
        if(p.isSending()&&!p.isHostEnabled()&&p.shouldKeepSession())s.message="DAW render paused streaming. Audio resumes with playback.";
        toggle.setButtonText(s.ending?"Ending session...":p.isSending()?(s.live?"Pause streaming":"Starting... | Pause"):sessionLatched?"Resume streaming":"Start streaming");
        toggle.setColour(juce::TextButton::buttonColourId,p.isSending()?juce::Colour(0xff303b37):juce::Colour(0xffbaf77a));
        toggle.setColour(juce::TextButton::textColourOffId,p.isSending()?studio::text:juce::Colour(0xff171e14));

        if(receiving){s.message=s.receiveMessage.isNotEmpty()?s.receiveMessage:"Ready to receive";s.warning=s.receivePhase=="error"||s.receivePhase=="passcode";toggle.setEnabled(s.available&&(p.isReceiving()||receiveTarget.getText().isNotEmpty()));toggle.setButtonText(receiveFailed?"Retry connection":p.isReceiving()?"Disconnect":"Connect");toggle.setColour(juce::TextButton::buttonColourId,p.isReceiving()?juce::Colour(0xff303b37):juce::Colour(0xffbaf77a));toggle.setColour(juce::TextButton::textColourOffId,p.isReceiving()?studio::text:juce::Colour(0xff171e14));}
        if(receiving){generate.setVisible(p.isReceiving()&&!s.receiving);generate.setEnabled(p.isReceiving());generate.setButtonText("Cancel");generate.setIcon(studio::ModernButton::Icon::none);}
        else generate.setIcon(studio::ModernButton::Icon::link);
        sessionPageButton.setVisible(!receiving);setupButton.setVisible(!receiving);setupButton.setEnabled(true);
        studio::syncToggleState(sessionPageButton,!showingSetup);studio::syncToggleState(setupButton,showingSetup);
        setupOverlay.setVisible(!receiving&&showingSetup);setupOverlay.configure(p.streamQuality,settingsEditable);
        endButton.setVisible(!receiving&&!showingSetup);endButton.setEnabled(!s.ending&&(sessionLatched||p.isSending()||s.generating));endButton.setButtonText(endConfirmTicks>0?"Confirm end":"End session");endButton.getProperties().set("role",endConfirmTicks>0?"danger":"secondary");
        localMute.setVisible(!receiving);localMute.setEnabled(p.isSending()&&!s.ending);localMute.setButtonText(p.localMuted()&&p.isSending()?"Unmute local audio":"Mute local audio");studio::syncToggleState(localMute,p.localMuted()&&p.isSending());
        const auto layoutKey=juce::String(int(showingSetup))+juce::String(int(receiving))+juce::String(int(p.isSending()))+juce::String(int(signedIn))+juce::String(int(custom))+juce::String(int(usePasscode.getToggleState()))+juce::String(int(updateVisible))+juce::String(int(receivePasscode.isVisible()));
        if(layoutKey!=lastLayoutKey){lastLayoutKey=layoutKey;resized();repaint(584,64,260,408);}
        if(copiedTicks>0&&--copiedTicks==0)copy.setButtonText("Copy link");
        if(!dragging&&!level.hasKeyboardFocus(true)){const double maximum=receiving?6:12;if(level.getMaximum()!=maximum)level.setRange(-60,maximum,.1);level.setValue(juce::jmin(p.gainDb(),static_cast<float>(maximum)),juce::dontSendNotification);}
        peaks[0]=juce::jmax(p.transport.leftPeak.exchange(0),peaks[0]*.88f);peaks[1]=juce::jmax(p.transport.rightPeak.exchange(0),peaks[1]*.88f);
        for(int ch=0;ch<2;++ch){if(peaks[ch]>=heldPeaks[ch]){heldPeaks[ch]=peaks[ch];peakHoldTicks[ch]=30;}else if(peakHoldTicks[ch]>0)--peakHoldTicks[ch];else heldPeaks[ch]*=.94f;}
        for(auto* button:{&generate,&copy,&qrButton,&toggle,&update,&ignoreUpdate,&more,&accountButton,&sendMode,&receiveMode,&claimLink,&setupButton,&localMute,&sessionPageButton,&endButton})button->refreshStyle();
        spectrum.update(p.signalCapture,p.signalRate());
        repaint(16,362,556,110);
        const auto timeTick=sessionLatched?juce::Time::currentTimeMillis()/1000:0;
        if(timeTick!=lastDurationTick){lastDurationTick=timeTick;repaint(748,72,78,20);}
        const auto paintKey=juce::String(int(showingSetup))+juce::String(int(sessionLatched))+juce::String(int(endConfirmTicks>0))+juce::String(int(s.ending))+s.link+s.linkMessage+juce::String(int(s.live))+juce::String(int(s.warning))+juce::String(int(s.linkBusy))+juce::String(int(s.passcodeRequired))+customName.getText()+juce::String(int(validDraftName()))+s.receivePhase;
        if(paintKey!=lastPaintKey){lastPaintKey=paintKey;repaint(584,64,260,408);}
        const auto footer=diagnosticsTicks>0?diagnosticsMessage:s.message;
        if(footer!=lastFooter){lastFooter=footer;repaint(16,477,556,28);}
    }
};
juce::AudioProcessorEditor* StreamProcessor::createEditor(){return new StreamEditor(*this);}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new StreamProcessor();}
