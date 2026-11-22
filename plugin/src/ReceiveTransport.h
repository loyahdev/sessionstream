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
    void render(float* left,float* right,int count,double outputRate,float firstGain,float gainStep)noexcept{float* outputs[]={left,right};render(outputs,right?2:1,count,outputRate,firstGain,gainStep);}
    void render(float* const* outputs,int channels,int count,double outputRate,float firstGain,float gainStep) noexcept {
        auto r=read.load(std::memory_order_relaxed);const auto w=write.load(std::memory_order_acquire);
        if(flushRequested.exchange(false)){r=w;primed=false;fraction=0;safetyGain=1.f;limiterActive=false;}
        if(!enabled.load()||outputRate<=0){read.store(w,std::memory_order_release);primed=false;fraction=0;safetyGain=1.f;limiterActive=false;for(int ch=0;ch<channels;++ch)std::fill_n(outputs[ch],count,0.f);return;}
        const double targetSec=juce::jlimit(20,400,targetBufferMs.load())/1000.0,maxLagSec=juce::jmax(.20,targetSec*3.0);
        if(w>r&&w-r>static_cast<uint64_t>(frames[r%capacity].rate*maxLagSec)){r=w-static_cast<uint64_t>(frames[(w-1)%capacity].rate*juce::jmax(.06,targetSec*1.25));fraction=0;primed=false;}
        if(!primed&&w>r&&w-r>=static_cast<uint64_t>(frames[r%capacity].rate*targetSec))primed=true;
        const float release=static_cast<float>(std::exp(-1.0/(outputRate*.1)));constexpr float ceiling=.891250938f;
        for(int i=0;i<count;++i){
            std::array<float,8> samples{};int sourceChannels=2;
            if(primed&&r+1<w){const auto& a=frames[r%capacity];const auto& b=frames[(r+1)%capacity];sourceChannels=a.channels;for(int ch=0;ch<sourceChannels;++ch)samples[size_t(ch)]=a.samples[size_t(ch)]+static_cast<float>(fraction)*(b.samples[size_t(ch)]-a.samples[size_t(ch)]);fraction+=a.rate/outputRate;const auto step=static_cast<uint64_t>(fraction);fraction-=static_cast<double>(step);r=juce::jmin(w,r+step);}else{primed=false;fraction=0;}
            if(channels<=2){float l=samples[0],rr=sourceChannels==1?l:samples[1];if(sourceChannels>=6){l+=.70710678f*(samples[2]+samples[4]+(sourceChannels==8?samples[6]:0.f));rr+=.70710678f*(samples[2]+samples[5]+(sourceChannels==8?samples[7]:0.f));}samples[0]=channels==1?(l+rr)*.5f:l;samples[1]=rr;}
            else if(sourceChannels==1)samples[1]=samples[0];
            const auto requested=firstGain+gainStep*i,gain=std::isfinite(requested)?juce::jlimit(0.f,1.995262315f,requested):0.f;float peak=0;
            for(int ch=0;ch<channels;++ch){auto& value=samples[size_t(ch)];value=std::isfinite(value)?juce::jlimit(-1000.f,1000.f,value)*gain:0.f;peak=juce::jmax(peak,std::abs(value));}
            const float target=peak>ceiling?ceiling/peak:1.f;safetyGain=target<safetyGain?target:target+(safetyGain-target)*release;
            for(int ch=0;ch<channels;++ch)outputs[ch][i]=juce::jlimit(-ceiling,ceiling,samples[size_t(ch)]*safetyGain);
        }
        limiterActive.store(safetyGain<.992f);read.store(r,std::memory_order_release);
    }

private:
    struct Frame{std::array<float,8> samples{};double rate=48000;int channels=2;};
    static constexpr uint64_t capacity=65536;
    std::array<Frame,capacity> frames;
    std::atomic<uint64_t> read{0},write{0};juce::DatagramSocket socket;
    float safetyGain=1.f;double fraction=0;bool primed=false;std::atomic<bool> flushRequested{false};
    static uint32_t u32(const unsigned char* p){return uint32_t(p[0])|(uint32_t(p[1])<<8)|(uint32_t(p[2])<<16)|(uint32_t(p[3])<<24);}
    void run()override{
        std::array<unsigned char,24+256*8*4> data{};
        while(!threadShouldExit()){
            if(socket.waitUntilReady(true,20)<=0)continue;const auto bytes=socket.read(data.data(),static_cast<int>(data.size()),false);
            if(bytes<24||std::memcmp(data.data(),"STRM",4)!=0||u32(data.data()+20)!=1)continue;
            const auto rate=u32(data.data()+8);const int count=data[12]|(data[13]<<8),channels=data[14]|(data[15]<<8);
            if(!enabled.load()||count<1||count>256||(channels!=1&&channels!=2&&channels!=6&&channels!=8)||bytes!=24+count*channels*4||!(rate==44100||rate==48000||rate==88200||rate==96000||rate==176400||rate==192000))continue;
            const auto w=write.load(std::memory_order_relaxed),r=read.load(std::memory_order_acquire);if(w-r+static_cast<uint64_t>(count)>capacity)continue;
            for(int i=0;i<count;++i){auto& frame=frames[(w+i)%capacity];frame.samples.fill(0.f);frame.rate=rate;frame.channels=channels;for(int ch=0;ch<channels;++ch){float value;std::memcpy(&value,data.data()+24+(i*channels+ch)*4,4);frame.samples[size_t(ch)]=std::isfinite(value)?value:0.f;}}

            write.store(w+count,std::memory_order_release);
        }
    }
};
