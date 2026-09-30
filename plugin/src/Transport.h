#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <cstring>

// One producer (DAW), one consumer (network thread). No allocation, locks,
// sockets, UI, or waiting in the audio callback. Float PCM, little endian.
struct AudioPacket {
    static constexpr int maxFrames = 256, headerSize = 24;
    std::array<std::byte, headerSize + maxFrames * 2 * sizeof(float)> bytes{};
    int size = 0; uint32_t created=0;
};
class StreamTransport final : private juce::Thread {
public:
    StreamTransport() : Thread("SessionStream UDP"), sourceId(juce::Random::getSystemRandom().nextInt()) { startThread(); }
    ~StreamTransport() override { stopThread(2000); }
    std::atomic<bool> enabled{false};
    std::atomic<uint64_t> dropped{0}, sent{0};
    std::atomic<float> leftPeak{0}, rightPeak{0};
    uint32_t getSourceId() const { return sourceId; }
    void resetPending() noexcept { pendingFrames=0; }
    void push(const float* left, const float* right, int count, uint32_t rate, float firstGain=1.f, float gainStep=0.f) noexcept {
        if(rate!=pendingRate){pendingFrames=0;pendingRate=rate;}
        for(int i=0;i<count;i++) {
            auto* b=pending.bytes.data();const float gain=firstGain+gainStep*i;
            const float l=left[i]*gain,r=right[i]*gain;
            std::memcpy(b+24+pendingFrames*8,&l,4);std::memcpy(b+28+pendingFrames*8,&r,4);
            if(++pendingFrames<AudioPacket::maxFrames)continue;
            pendingFrames=0;std::memcpy(b,"STRM",4);put32(b+4,sequence++);put32(b+8,rate);
            put16(b+12,AudioPacket::maxFrames);put16(b+14,2);put32(b+16,sourceId);put32(b+20,1);
            pending.size=AudioPacket::headerSize+AudioPacket::maxFrames*8;pending.created=juce::Time::getMillisecondCounter();
            const auto w=writeIndex.load(std::memory_order_relaxed);
            if(w-readIndex.load(std::memory_order_acquire)>=slots){++dropped;continue;}
            packets[w%slots]=pending;writeIndex.store(w+1,std::memory_order_release);
        }
    }
private:
    static constexpr uint64_t slots = 128;
    std::array<AudioPacket, slots> packets;
    std::atomic<uint64_t> writeIndex{0}, readIndex{0};
    uint32_t sequence = 0, sourceId;
    AudioPacket pending; int pendingFrames=0; uint32_t pendingRate=48000;
    static void put32(std::byte* p, uint32_t v) noexcept { for (int i = 0; i < 4; ++i) p[i] = std::byte((v >> (8 * i)) & 255); }
    static void put16(std::byte* p, uint16_t v) noexcept { p[0] = std::byte(v & 255); p[1] = std::byte(v >> 8); }
    void run() override {
        juce::DatagramSocket socket(false);
        while (!threadShouldExit()) {
            auto r = readIndex.load(std::memory_order_relaxed);
            const auto w = writeIndex.load(std::memory_order_acquire);
            if(!enabled.load()){readIndex.store(w,std::memory_order_release);wait(2);continue;}
            if (r == w) { wait(2); continue; }
            const auto& p = packets[r % slots];
            if (enabled.load(std::memory_order_relaxed) && juce::Time::getMillisecondCounter()-p.created<200) {
                if (socket.write("127.0.0.1", 49300, p.bytes.data(), p.size) == p.size) ++sent;
                else ++dropped;
            }
            readIndex.store(r + 1, std::memory_order_release);
        }
    }
};
