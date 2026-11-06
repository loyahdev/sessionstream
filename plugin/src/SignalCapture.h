#pragma once
#include <algorithm>
#include <array>
#include <atomic>
#include <cmath>
#include <cstdint>
// Single audio producer, single editor consumer. Full visualization queues drop
// display samples; they never wait, allocate, or interfere with audio delivery.
class SignalCapture {
public:
    struct Frame { float left=0,right=0; };
    static constexpr uint32_t capacity=16384;
    std::atomic<bool> active{false};
    void push(const float* l,const float* r,int count,float gain,float step) noexcept {
        if(!active.load(std::memory_order_relaxed))return;
        auto w=write.load(std::memory_order_relaxed);const auto available=capacity-(w-read.load(std::memory_order_acquire));
        const auto n=std::min(uint32_t(count),available);
        for(uint32_t i=0;i<n;++i){const auto g=gain+step*i;const float a=l[i]*g,b=r[i]*g;frames[(w+i)%capacity]={std::isfinite(a)?a:0.f,std::isfinite(b)?b:0.f};}
        write.store(w+n,std::memory_order_release);
    }
    template<class Consumer> void drain(Consumer consume){auto pos=read.load(std::memory_order_relaxed);const auto end=write.load(std::memory_order_acquire);while(pos!=end){consume(frames[pos%capacity]);++pos;}read.store(pos,std::memory_order_release);}
private:
    std::array<Frame,capacity> frames{};
    std::atomic<uint32_t> write{0},read{0};
};
