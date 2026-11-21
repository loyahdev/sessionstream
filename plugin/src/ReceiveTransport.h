#pragma once
#include <juce_core/juce_core.h>
#include <array>
#include <atomic>
#include <cstring>
#include <cmath>
#include "WorkerThread.h"

// UDP/network work stays on this worker. The DAW consumes a bounded SPSC
// stereo FIFO, resampling to its own sample rate without locks or allocation.
class ReceiveTransport final : private WorkerThread {
public:
    ReceiveTransport():WorkerThread("SessionStream receive"),socket(false){if(socket.bindToPort(0,"127.0.0.1"))startThread();}
    ~ReceiveTransport() override{stopThread();}
    int port()const{return socket.getBoundPort();}
    std::atomic<bool> enabled{false},limiterActive{false};
    std::atomic<int> targetBufferMs{40};
    void setTargetBufferMs(int ms)noexcept{targetBufferMs.store(juce::jlimit(20,400,ms),std::memory_order_relaxed);}
    void flush()noexcept{flushRequested=true;limiterActive.store(false,std::memory_order_relaxed);}
    void render(float* left,float* right,int count,double outputRate,float firstGain,float gainStep) noexcept {
        auto r=read.load(std::memory_order_relaxed);const auto w=write.load(std::memory_order_acquire);
        if(flushRequested.exchange(false)){r=w;primed=false;fraction=0;safetyGain=1.f;limiterActive.store(false,std::memory_order_relaxed);}
        if(!enabled.load()||outputRate<=0){read.store(w,std::memory_order_release);primed=false;fraction=0;safetyGain=1.f;limiterActive.store(false,std::memory_order_relaxed);for(int i=0;i<count;++i){left[i]=0;if(right)right[i]=0;}return;}
        const double targetSec=juce::jlimit(20,400,targetBufferMs.load(std::memory_order_relaxed))/1000.0;
        const double maxLagSec=juce::jmax(.20,targetSec*3.0);
        if(w>r&&w-r>static_cast<uint64_t>(frames[r%capacity].rate*maxLagSec)){r=w-static_cast<uint64_t>(frames[(w-1)%capacity].rate*juce::jmax(.06,targetSec*1.25));fraction=0;primed=false;}
        if(!primed&&w>r&&w-r>=static_cast<uint64_t>(frames[r%capacity].rate*targetSec))primed=true;
        const float release=static_cast<float>(std::exp(-1.0/(outputRate*.1)));
        constexpr float ceiling=.891250938f; // -1 dBFS, after receive gain.
        for(int i=0;i<count;++i){
            float l=0,rr=0;
            if(primed&&r+1<w){
                const auto& a=frames[r%capacity];const auto& b=frames[(r+1)%capacity];
                l=a.l+static_cast<float>(fraction)*(b.l-a.l);rr=a.r+static_cast<float>(fraction)*(b.r-a.r);
                fraction+=a.rate/outputRate;const auto step=static_cast<uint64_t>(fraction);fraction-=static_cast<double>(step);r=juce::jmin(w,r+step);
            }else{primed=false;fraction=0;}
            const auto requested=firstGain+gainStep*i;
            const auto gain=std::isfinite(requested)?juce::jlimit(0.f,1.995262315f,requested):0.f;
            l*=gain;rr*=gain;if(!std::isfinite(l))l=0;if(!std::isfinite(rr))rr=0;
            const auto peak=juce::jmax(std::abs(l),std::abs(rr));const auto target=peak>ceiling?ceiling/peak:1.f;
            safetyGain=target<safetyGain?target:target+(safetyGain-target)*release;
            left[i]=juce::jlimit(-ceiling,ceiling,(right?l:(l+rr)*.5f)*safetyGain);
            if(right)right[i]=juce::jlimit(-ceiling,ceiling,rr*safetyGain);
        }
        limiterActive.store(safetyGain<.992f,std::memory_order_relaxed);
        read.store(r,std::memory_order_release);
    }
private:
    struct Frame{float l=0,r=0;double rate=48000;};
    static constexpr uint64_t capacity=65536;
    std::array<Frame,capacity> frames;
    std::atomic<uint64_t> read{0},write{0};juce::DatagramSocket socket;
    float safetyGain=1.f;double fraction=0;bool primed=false;std::atomic<bool> flushRequested{false};
    static uint32_t u32(const unsigned char* p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
    void run()override{
        std::array<unsigned char,24+256*8> data{};
        while(!threadShouldExit()){
            if(socket.waitUntilReady(true,20)<=0)continue;const auto bytes=socket.read(data.data(),static_cast<int>(data.size()),false);
            if(bytes<24||std::memcmp(data.data(),"STRM",4)!=0||u32(data.data()+20)!=1)continue;
            const auto rate=u32(data.data()+8);const int count=data[12]|(data[13]<<8),channels=data[14]|(data[15]<<8);
            if(!enabled.load()||count<1||count>256||channels!=2||bytes!=24+count*8||!(rate==44100||rate==48000||rate==88200||rate==96000||rate==176400||rate==192000))continue;
            const auto w=write.load(std::memory_order_relaxed),r=read.load(std::memory_order_acquire);if(w-r+static_cast<uint64_t>(count)>capacity)continue;
            for(int i=0;i<count;++i){float l,rr;std::memcpy(&l,data.data()+24+i*8,4);std::memcpy(&rr,data.data()+28+i*8,4);frames[(w+i)%capacity]={std::isfinite(l)?l:0.f,std::isfinite(rr)?rr:0.f,static_cast<double>(rate)};}
            write.store(w+count,std::memory_order_release);
        }
    }
};
