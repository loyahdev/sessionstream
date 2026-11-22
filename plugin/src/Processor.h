#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "Transport.h"
#include "ReceiveTransport.h"
#include "Controller.h"
#include "UpdateChecker.h"
#include "HostActivity.h"
#include "SignalCapture.h"
#include "ShortTermLoudness.h"
class StreamProcessor final : public juce::AudioProcessor {
public:
    explicit StreamProcessor(UpdateChecker::Fetch reader={},int streamPort=49300);
    ~StreamProcessor() override { releaseResources(); controller.reset(); }
    void prepareToPlay(double rate, int) override { ++prepareCount; currentRate = static_cast<uint32_t>(rate); loudness.prepare(rate); localMonitor.reset(rate,.01);localMonitor.setCurrentAndTargetValue(1.f);gain.reset(rate,.02); gain.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(gainParameter->get())); hostActivity.prepare(); if(controller){controller->inputLayout(getMainBusNumInputChannels());controller->sessionSettings(streamQuality,linkExpiryHours,streamChannels);controller->wake();} }
    void releaseResources() override { ++releaseCount; receiver.enabled=false;receiver.flush();hostActivity.deactivate(); transport.enabled=false; transport.resetPending(); if(controller)controller->wake(); }
    // VST3 setProcessing(false) calls reset when a host flushes audio (e.g.
    // seeking). The component is still active; keep its lease and invite.
    void reset() override { ++resetCount; transport.resetPending(); }
    void setNonRealtime(bool offline) noexcept override { AudioProcessor::setNonRealtime(offline); if(offline)transport.enabled=false; }
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorParameter* getBypassParameter() const override { return bypassParameter; }
    bool isHostEnabled() const { return hostActivity.enabled() && !bypassParameter->get() && !isSuspended() && !isNonRealtime(); }
    bool shouldKeepSession() const { return hostActivity.sessionEnabled() && !bypassParameter->get(); }
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return "SessionStream"; }
    bool acceptsMidi() const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return {}; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;
    SignalCapture signalCapture;
    ShortTermLoudness loudness;
    double signalRate() const {return currentRate.load();}
    StreamTransport transport;
    ReceiveTransport receiver;
    bool isReceiveMode() const{return receiveMode.load();}
    void setReceiveMode(bool value){setSending(false);receiveMode=value;receiver.enabled=false;receiver.flush();if(!value)connectReceive(false);}
    bool isReceiving()const{return receiveRequested.load();}
    int receiveBufferMs()const{const int idx=receiveBufferIndex.load();return idx==1?90:idx==2?200:40;}
    void setReceiveBufferIndex(int idx){receiveBufferIndex.store(juce::jlimit(0,2,idx));receiver.setTargetBufferMs(receiveBufferMs());}
    void connectReceive(bool value,const juce::String& target={},const juce::String& passcode={}){receiveRequested=value;receiver.setTargetBufferMs(receiveBufferMs());receiver.enabled=value;receiver.flush();if(controller)controller->receive(value,target,passcode,receiver.port(),receiveLowLatency.load());}

    void setSending(bool value) { sendParameter->setValueNotifyingHost(value ? 1.f : 0.f); if(!value){transport.enabled=false;sendLimiterActive.store(false,std::memory_order_relaxed);} transport.wake(); if(controller)controller->wake(); }
    bool isSending() const { return sendParameter->get()&&!receiveMode.load(); }
    std::unique_ptr<StreamController> controller;
    UpdateChecker updates;
    std::atomic<int> streamQuality{1},streamChannels{2},linkExpiryHours{0},receiveBufferIndex{0},uiScaleIndex{0};
    std::atomic<bool> receiveLowLatency{false},sendLimiterActive{false};
    bool localMuted()const {return muteParameter->get();}
    void setLocalMuted(bool value){muteParameter->setValueNotifyingHost(value?1.f:0.f);}
    float gainDb() const { return gainParameter->get(); }
    void setGainDb(float db) { gainParameter->setValueNotifyingHost(gainParameter->convertTo0to1(db)); }
    juce::String diagnostics() const;
private:
    std::atomic<bool> receiveMode{false},receiveRequested{false};
    HostActivity hostActivity;
    juce::SmoothedValue<float> gain{1.f},localMonitor{1.f};
    juce::AudioParameterBool* muteParameter=nullptr;
    juce::AudioParameterFloat* gainParameter=nullptr;
    std::atomic<uint32_t> currentRate{48000};
    std::atomic<uint64_t> prepareCount{0},releaseCount{0},resetCount{0},offlineBlocks{0};
    juce::AudioParameterBool* sendParameter = nullptr;
    juce::AudioParameterBool* bypassParameter = nullptr;
};
