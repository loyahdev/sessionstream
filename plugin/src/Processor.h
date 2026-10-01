#pragma once
#include <juce_audio_utils/juce_audio_utils.h>
#include "Transport.h"
#include "Controller.h"
#include "UpdateChecker.h"
#include "HostActivity.h"
class StreamProcessor final : public juce::AudioProcessor {
public:
    explicit StreamProcessor(UpdateChecker::Fetch reader={});
    ~StreamProcessor() override { releaseResources(); controller.reset(); }
    void prepareToPlay(double rate, int) override { currentRate = static_cast<uint32_t>(rate); gain.reset(rate,.02); gain.setCurrentAndTargetValue(juce::Decibels::decibelsToGain(gainParameter->get())); hostActivity.prepare(); }
    void releaseResources() override { hostActivity.deactivate(); transport.enabled=false; if(controller)controller->wake(); }
    void reset() override { releaseResources(); }
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    void processBlockBypassed(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorParameter* getBypassParameter() const override { return bypassParameter; }
    bool isHostEnabled() const { return hostActivity.enabled() && !bypassParameter->get() && !isSuspended() && !isNonRealtime(); }
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
    StreamTransport transport;
    void setSending(bool value) { sendParameter->setValueNotifyingHost(value ? 1.f : 0.f); if(!value)transport.enabled=false; transport.wake(); if(controller)controller->wake(); }
    bool isSending() const { return sendParameter->get(); }
    std::unique_ptr<StreamController> controller;
    UpdateChecker updates;
    float gainDb() const { return gainParameter->get(); }
    void setGainDb(float db) { gainParameter->setValueNotifyingHost(gainParameter->convertTo0to1(db)); }
private:
    HostActivity hostActivity;
    juce::SmoothedValue<float> gain{1.f};
    juce::AudioParameterFloat* gainParameter=nullptr;
    uint32_t currentRate = 48000;
    juce::AudioParameterBool* sendParameter = nullptr;
    juce::AudioParameterBool* bypassParameter = nullptr;
};
