#include "Processor.h"
#include <iostream>
int main() {
    juce::ScopedJuceInitialiser_GUI init;
    juce::DatagramSocket receiver(false);
    if (!receiver.bindToPort(49300, "127.0.0.1")) { std::cerr << "Stop bridge before native test\n"; return 1; }
    StreamProcessor p;
    p.prepareToPlay(48000, 512);
    p.setSending(true);
    juce::AudioBuffer<float> b(2, 512); juce::MidiBuffer midi;
    for (int i = 0; i < 512; ++i) { b.setSample(0, i, float(i)/1024.f); b.setSample(1, i, -float(i)/2048.f); }
    juce::AudioBuffer<float> original; original.makeCopyOf(b);
    p.processBlock(b, midi);
    for (int ch = 0; ch < 2; ++ch) for (int i = 0; i < 512; ++i)
        if (b.getSample(ch, i) != original.getSample(ch, i)) return 2;
    std::array<char, 4096> packet{};
    for (int n = 0; n < 2; ++n) {
        if (receiver.waitUntilReady(true, 1000) <= 0) return 3;
        const int len = receiver.read(packet.data(), int(packet.size()), false);
        if (len != 2072 || std::memcmp(packet.data(), "STRM", 4)) return 4;
        float l, r; std::memcpy(&l, packet.data() + 24, 4); std::memcpy(&r, packet.data() + 28, 4);
        if (l != original.getSample(0, n * 256) || r != original.getSample(1, n * 256)) return 5;
    }
    // A seek must discard a partial pre-seek packet without deactivating Send.
    juce::AudioBuffer<float> partial(2,128);
    for(int i=0;i<128;i++){partial.setSample(0,i,.25f);partial.setSample(1,i,-.25f);}
    p.processBlock(partial,midi);p.reset();
    if(!p.isHostEnabled()||!p.isSending())return 15;
    for(int i=0;i<128;i++){partial.setSample(0,i,.5f);partial.setSample(1,i,-.5f);}
    p.processBlock(partial,midi);
    if(receiver.waitUntilReady(true,100)>0)return 16;
    p.processBlock(partial,midi);
    if(receiver.waitUntilReady(true,1000)<=0)return 17;
    if(receiver.read(packet.data(),int(packet.size()),false)!=2072)return 18;
    for(int i=0;i<256;i++){
        float l,r;std::memcpy(&l,packet.data()+24+i*8,4);std::memcpy(&r,packet.data()+28+i*8,4);
        if(l!=.5f||r!=-.5f)return 19;
    }
    p.setSending(false); p.processBlock(b, midi);
    if (receiver.waitUntilReady(true, 100) > 0) return 6;
    // Stream gain changes the transmitted copy only and persists safely.
    p.setGainDb(-6.f);for(int i=0;i<4;i++)p.processBlock(b,midi);
    p.setSending(true);p.processBlock(b,midi);
    const float expected=juce::Decibels::decibelsToGain(-6.f);
    for(int n=0;n<2;n++){
        if(receiver.waitUntilReady(true,1000)<=0)return 8;
        receiver.read(packet.data(),int(packet.size()),false);float l;std::memcpy(&l,packet.data()+24,4);
        if(std::abs(l-original.getSample(0,n*256)*expected)>1.e-6f)return 9;
    }
    for(int ch=0;ch<2;ch++)for(int i=0;i<512;i++)if(b.getSample(ch,i)!=original.getSample(ch,i))return 10;
    juce::MemoryBlock state;p.getStateInformation(state);p.setGainDb(0);p.setStateInformation(state.getData(),int(state.getSize()));
    if(p.isSending()||std::abs(p.gainDb()+6)>1.e-4f)return 11;
    p.setStateInformation(nullptr, 0);
    if (p.transport.enabled.load()) return 7;
    // A large Ableton callback used to discard its own queue after eight packets.
    StreamTransport burst;burst.enabled=true;juce::AudioBuffer<float> large(2,8192);large.clear();burst.push(large.getReadPointer(0),large.getReadPointer(1),8192,48000);
    for(int n=0;n<32;n++){if(receiver.waitUntilReady(true,1000)<=0)return 12;if(receiver.read(packet.data(),int(packet.size()),false)!=2072)return 13;}
    if(burst.dropped.load()!=0)return 14;
    std::cout << "PASS: unchanged stereo passthrough, UDP PCM packets, seek packet reset, stream gain, safe restore, complete 8192-frame burst\n";
}
