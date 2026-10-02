#include "Processor.h"
#include "InviteQR.h"
juce::String StreamProcessor::diagnostics() const {
    // Explicit allowlist: exclude invites, passcodes, tokens, paths and
    // free-form engine errors, which can contain private connection details.
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
    data->setProperty("engineAvailable",state.available);
    data->setProperty("creatingInvite",state.generating);
    data->setProperty("inviteReady",state.link.isNotEmpty());
    data->setProperty("live",state.live);
    data->setProperty("listeners",state.listeners);
    data->setProperty("playbackWarning",state.warning);
    return juce::JSON::toString(juce::var(data));
}
StreamProcessor::StreamProcessor(UpdateChecker::Fetch reader) : AudioProcessor(BusesProperties().withInput("Input", juce::AudioChannelSet::stereo(), true).withOutput("Output", juce::AudioChannelSet::stereo(), true)), updates(std::move(reader)) {
    sendParameter=new juce::AudioParameterBool(juce::ParameterID("send",1),"Send audio",false);addParameter(sendParameter);
    gainParameter=new juce::AudioParameterFloat(juce::ParameterID("streamGain",1),"Stream output dB",juce::NormalisableRange<float>(-60.f,12.f,.1f),0.f);addParameter(gainParameter);
    bypassParameter=new juce::AudioParameterBool(juce::ParameterID("bypass",1),"Bypass",false);addParameter(bypassParameter);
    controller=std::make_unique<StreamController>(transport.getSourceId(),[this]{return isSending();},"http://127.0.0.1:8788",juce::File{},[this]{
        const bool active=isHostEnabled();
        if(!active)transport.enabled=false;
        return active;
    });
}
bool StreamProcessor::isBusesLayoutSupported(const BusesLayout& l) const {
    return l.getMainInputChannelSet()==l.getMainOutputChannelSet()&&(l.getMainInputChannelSet()==juce::AudioChannelSet::stereo()||l.getMainInputChannelSet()==juce::AudioChannelSet::mono());
}
void StreamProcessor::processBlock(juce::AudioBuffer<float>& b, juce::MidiBuffer&) {
    hostActivity.block(bypassParameter->get(),isNonRealtime());
    if(bypassParameter->get()||isNonRealtime()){transport.enabled=false;transport.resetPending();return;}
    juce::ScopedNoDenormals guard;transport.enabled.store(isSending()&&!isSuspended(),std::memory_order_relaxed);
    if(b.getNumChannels()<1||b.getNumSamples()<1)return;
    const int r=b.getNumChannels()>1?1:0,n=b.getNumSamples();
    gain.setTargetValue(juce::Decibels::decibelsToGain(gainParameter->get()));
    const float first=gain.getCurrentValue(),last=gain.skip(n),step=(last-first)/n;
    float lPeak=0,rPeak=0;
    for(int i=0;i<n;i++){const auto g=first+step*i;lPeak=juce::jmax(lPeak,std::abs(b.getSample(0,i)*g));rPeak=juce::jmax(rPeak,std::abs(b.getSample(r,i)*g));}
    transport.leftPeak.store(juce::jmax(lPeak,transport.leftPeak.load()));transport.rightPeak.store(juce::jmax(rPeak,transport.rightPeak.load()));
    if(transport.enabled.load())transport.push(b.getReadPointer(0),b.getReadPointer(r),n,currentRate,first,step);else transport.resetPending();
}
void StreamProcessor::processBlockBypassed(juce::AudioBuffer<float>&,juce::MidiBuffer&) {
    hostActivity.block(true,isNonRealtime());transport.enabled=false;transport.resetPending();
}
void StreamProcessor::getStateInformation(juce::MemoryBlock& state) {
    juce::MemoryOutputStream stream(state,false);stream.writeFloat(gainDb());
}
void StreamProcessor::setStateInformation(const void* data,int size) {
    setSending(false);transport.enabled=false;
    if(size==4){juce::MemoryInputStream stream(data,static_cast<size_t>(size),false);const auto db=stream.readFloat();if(std::isfinite(db))setGainDb(juce::jlimit(-60.f,12.f,db));}
}
// Keep QR content owned by the editor, so host removal destroys it together
// with the plugin rather than leaving a deferred popup callback behind.
class InviteOverlay final : public juce::Component {
public:
    InviteOverlay(){addAndMakeVisible(qr);qr.onClose=[this]{setVisible(false);};setWantsKeyboardFocus(true);}
    void show(const juce::String& link){qr.setInvite(link);setVisible(true);toFront(true);grabKeyboardFocus();}
    void refresh(const juce::String& link){if(isVisible()&&qr.getEncodedInvite()!=link)qr.setInvite(link);}
    void resized() override {qr.setTopLeftPosition((getWidth()-qr.getWidth())/2,(getHeight()-qr.getHeight())/2);}
    void paint(juce::Graphics& g) override {g.fillAll(juce::Colour(0xe0141917));}
    bool keyPressed(const juce::KeyPress& key) override {if(key==juce::KeyPress::escapeKey){setVisible(false);return true;}return false;}
private:
    InviteQR qr;
};
class StreamEditor final : public juce::AudioProcessorEditor,private juce::Timer {
public:
    explicit StreamEditor(StreamProcessor& processor):AudioProcessorEditor(processor),p(processor){
        for(auto* b:{&generate,&copy,&qrButton,&toggle,&update,&ignoreUpdate}){addAndMakeVisible(b);b->setColour(juce::TextButton::buttonColourId,juce::Colour(0xff29382d));b->setColour(juce::TextButton::textColourOffId,juce::Colour(0xffd8f8c3));}
        generate.setButtonText("Generate share link");copy.setButtonText("Copy link");toggle.setButtonText("Start streaming");
        qrButton.setButtonText("Generate QR code");qrButton.onClick=[this]{qrOverlay.show(p.controller->status().link);};
        addAndMakeVisible(usePasscode);usePasscode.setButtonText("Use passcode");usePasscode.setColour(juce::ToggleButton::textColourId,juce::Colour(0xffb3bfb6));
        addAndMakeVisible(passcode);passcode.setPasswordCharacter(0x2022);passcode.setInputRestrictions(64);passcode.setTextToShowWhenEmpty("Enter a passcode for the next link",juce::Colour(0xff9ba69e));passcode.setFont(juce::FontOptions(12));passcode.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff1e2721));passcode.setColour(juce::TextEditor::textColourId,juce::Colour(0xffd8f8c3));passcode.setVisible(false);
        usePasscode.onClick=[this]{passcode.setVisible(usePasscode.getToggleState());if(usePasscode.getToggleState())passcode.grabKeyboardFocus();else passcode.clear();};
        generate.onClick=[this]{if(usePasscode.getToggleState()&&passcode.getText().isEmpty()){passcode.grabKeyboardFocus();return;}generate.setEnabled(false);usePasscode.setEnabled(false);passcode.setEnabled(false);p.setSending(false);p.controller->generate(usePasscode.getToggleState()?passcode.getText():juce::String{});};
        copy.onClick=[this]{juce::SystemClipboard::copyTextToClipboard(p.controller->status().link);copy.setButtonText("Copied");copiedTicks=30;};
        toggle.onClick=[this]{p.setSending(!p.isSending());};
        addAndMakeVisible(invite);invite.setReadOnly(true);invite.setFont(juce::FontOptions(12));invite.setColour(juce::TextEditor::backgroundColourId,juce::Colour(0xff1e2721));invite.setColour(juce::TextEditor::textColourId,juce::Colour(0xffb3bfb6));
        addAndMakeVisible(level);level.setRange(-60,12,.1);level.setSliderStyle(juce::Slider::LinearHorizontal);level.setTextBoxStyle(juce::Slider::TextBoxRight,false,88,28);level.setTextValueSuffix(" dB");level.setValue(p.gainDb());level.setColour(juce::Slider::trackColourId,juce::Colour(0xffbaf77a));
        level.onDragStart=[this]{dragging=true;};level.onDragEnd=[this]{dragging=false;};level.onValueChange=[this]{p.setGainDb(static_cast<float>(level.getValue()));};
        update.setButtonText("Get update");ignoreUpdate.setButtonText("Ignore for this session");
        update.onClick=[]{juce::URL(UpdateChecker::releasesURL).launchInDefaultBrowser();};
        ignoreUpdate.onClick=[this]{p.updates.ignoreForSession();refreshUpdate();};
        update.setVisible(false);ignoreUpdate.setVisible(false);
        addChildComponent(qrOverlay);
        addAndMakeVisible(more);more.setButtonText("...");more.setTooltip("More options");more.setTitle("More options");
        more.setColour(juce::TextButton::buttonColourId,juce::Colours::transparentBlack);more.setColour(juce::TextButton::textColourOffId,juce::Colour(0xff9ba69e));
        more.onClick=[this]{
            juce::PopupMenu troubleshooting;troubleshooting.addItem(1,"Copy diagnostics");
            juce::PopupMenu menu;menu.addSubMenu("Troubleshooting",troubleshooting);menu.addItem(2,"Compatibility");
            const juce::Component::SafePointer<StreamEditor> safe(this);
            menu.showMenuAsync(juce::PopupMenu::Options().withTargetComponent(&more),[safe](int result){
                if(!safe)return;
                if(result==1){juce::SystemClipboard::copyTextToClipboard(safe->p.diagnostics());safe->diagnosticsTicks=60;safe->repaint();}
                if(result==2)juce::AlertWindow::showMessageBoxAsync(juce::MessageBoxIconType::InfoIcon,"SessionStream compatibility","Works with most DAWs that support VST3, and AU hosts on macOS.\n\nmacOS 13.5+: Apple Silicon, VST3 + AU\nWindows 11: Intel/AMD x64 + ARM64, VST3\n\nUse AU in Logic Pro. Pro Tools requires AAX, which is not included. Windows ARM64 uses an x64 streaming helper under emulation. Intel Macs and 32-bit DAWs are not supported.");
            });
        };
        p.controller->prepare();p.updates.check();setSize(560,508);startTimerHz(20);
    }
    void resized() override {
        more.setBounds(506,20,30,28);
        level.setBounds(24,193,512,36);usePasscode.setBounds(28,313,136,30);passcode.setBounds(166,313,366,30);generate.setBounds(28,357,246,38);copy.setBounds(286,357,100,38);qrButton.setBounds(398,357,134,38);invite.setBounds(28,403,504,30);toggle.setBounds(28,449,504,38);update.setBounds(28,552,238,36);ignoreUpdate.setBounds(278,552,254,36);qrOverlay.setBounds(getLocalBounds());
    }
    void paint(juce::Graphics& g) override {
        g.fillAll(juce::Colour(0xff141917));g.setColour(juce::Colour(0xffbaf77a));g.setFont(juce::FontOptions(13));g.drawText(juce::String("SESSION / STREAM  ")+UpdateChecker::currentVersion,28,22,330,24,juce::Justification::left);
        g.setColour(juce::Colours::white);g.setFont(juce::FontOptions(31));g.drawText("Your session. Anywhere.",28,55,504,46,juce::Justification::left);
        g.setColour(juce::Colour(0xff9ba69e));g.setFont(juce::FontOptions(13));g.drawText("Share this track with a private link. Listeners just press Start listening.",28,106,504,22,juce::Justification::left);
        g.drawText("STREAM OUTPUT",28,160,290,25,juce::Justification::left);g.drawText("DAW level stays unchanged",300,160,232,25,juce::Justification::right);
        for(int ch=0;ch<2;ch++){
            const float db=juce::Decibels::gainToDecibels(peaks[ch],-60.f),y=239.f+ch*25;
            g.setColour(juce::Colour(0xff9ba69e));g.drawText(ch?"R":"L",28,static_cast<int>(y)-5,18,23,juce::Justification::left);
            g.setColour(juce::Colour(0xff2b342e));g.fillRoundedRectangle(50,y,382,12,3);
            g.setColour(peaks[ch]>=1?juce::Colour(0xfff18a75):juce::Colour(0xffbaf77a));g.fillRoundedRectangle(50,y,382*juce::jlimit(0.f,1.f,(db+60)/60),12,3);
            g.drawText(db<=-60?"-inf dBFS":juce::String(db,1)+" dBFS",440,static_cast<int>(y)-5,92,23,juce::Justification::right);
        }
        g.setColour(juce::Colour(0xff9ba69e));g.setFont(juce::FontOptions(11));for(int i=0;i<=4;i++)g.drawText(juce::String(-60+i*15),44+i*95,282,40,18,juce::Justification::left);
        g.setColour(s.warning?juce::Colour(0xfff1b675):s.live?juce::Colour(0xffbaf77a):juce::Colour(0xff9ba69e));g.setFont(juce::FontOptions(12));g.drawText(s.message,28,132,504,22,juce::Justification::left);
        g.drawText(diagnosticsTicks>0?"Diagnostics copied":s.live?juce::String(s.listeners)+" listening":"PRIVATE INVITE",354,23,142,22,juce::Justification::right);
        if(updateVisible){
            g.setColour(juce::Colour(0xff344139));g.drawHorizontalLine(503,28,532);
            g.setColour(juce::Colour(0xffbaf77a));g.setFont(juce::FontOptions(14));
            g.drawText("SessionStream "+latest+" is available.",28,517,504,24,juce::Justification::left);
        }
    }
private:
    StreamProcessor& p;juce::TextButton generate,copy,qrButton,toggle,update,ignoreUpdate,more;juce::ToggleButton usePasscode;juce::Slider level;juce::TextEditor invite,passcode;InviteOverlay qrOverlay;StreamController::Status s;float peaks[2]{};int copiedTicks=0,diagnosticsTicks=0;bool dragging=false,updateVisible=false;juce::String latest;
    void refreshUpdate(){const auto u=p.updates.status();latest=u.latest;if(u.available!=updateVisible){updateVisible=u.available;update.setVisible(updateVisible);ignoreUpdate.setVisible(updateVisible);setSize(560,updateVisible?608:508);}}
    void timerCallback() override {
        if(diagnosticsTicks>0)--diagnosticsTicks;
        refreshUpdate();
        s=p.controller->status();if(invite.getText()!=s.link)invite.setText(s.link,false);
        const bool canGenerate=p.isHostEnabled()&&!p.isSending()&&!s.generating;
        copy.setEnabled(s.link.isNotEmpty());qrButton.setEnabled(s.link.isNotEmpty());toggle.setEnabled(p.isHostEnabled()&&(s.link.isNotEmpty()||p.isSending()));generate.setEnabled(canGenerate&&(!usePasscode.getToggleState()||passcode.getText().isNotEmpty()));usePasscode.setEnabled(canGenerate);passcode.setEnabled(canGenerate);generate.setButtonText(s.generating?"Creating share link...":"Generate share link");
        invite.setTooltip(s.passcodeRequired?"This link requires the passcode used when it was generated.":"Private listener link");qrOverlay.refresh(s.link);
        toggle.setButtonText(p.isSending()?(s.live?"Stop streaming":"Starting... | Stop"):"Start streaming");
        if(copiedTicks>0&&--copiedTicks==0)copy.setButtonText("Copy link");
        if(!dragging)level.setValue(p.gainDb(),juce::dontSendNotification);
        peaks[0]=juce::jmax(p.transport.leftPeak.exchange(0),peaks[0]*.88f);peaks[1]=juce::jmax(p.transport.rightPeak.exchange(0),peaks[1]*.88f);repaint();
    }
};
juce::AudioProcessorEditor* StreamProcessor::createEditor(){return new StreamEditor(*this);}
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter(){return new StreamProcessor();}
