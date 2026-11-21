#pragma once
#include <array>
#include <atomic>
#include <cmath>
#include <limits>

class ShortTermLoudness {
public:
    void prepare(double sampleRate) noexcept {
        const double rate=sampleRate>0?sampleRate:48000;
        framesPerBucket=static_cast<int>(std::round(rate/10));
        // ITU-R BS.1770 K weighting, with the two stages retuned to the host rate.
        constexpr double pi=3.14159265358979323846;
        const auto shelfK=std::tan(pi*1681.974450955533/rate);
        const auto shelfQ=0.7071752369554196;
        const auto shelfGain=std::pow(10.0,3.999843853973347/20.0);
        const auto midGain=std::pow(shelfGain,0.4996667741545416);
        const auto shelfDenominator=1+shelfK/shelfQ+shelfK*shelfK;
        const Biquad shelf{
            (shelfGain+midGain*shelfK/shelfQ+shelfK*shelfK)/shelfDenominator,
            2*(shelfK*shelfK-shelfGain)/shelfDenominator,
            (shelfGain-midGain*shelfK/shelfQ+shelfK*shelfK)/shelfDenominator,
            2*(shelfK*shelfK-1)/shelfDenominator,
            (1-shelfK/shelfQ+shelfK*shelfK)/shelfDenominator
        };
        const auto highPassK=std::tan(pi*38.13547087602444/rate);
        const auto highPassQ=0.5003270373238773;
        const auto highPassDenominator=1+highPassK/highPassQ+highPassK*highPassK;
        const Biquad highPass{1,-2,1,2*(highPassK*highPassK-1)/highPassDenominator,
            (1-highPassK/highPassQ+highPassK*highPassK)/highPassDenominator};
        for(auto& channel:channels)channel={shelf,highPass};
        clear();
    }

    void clear() noexcept {
        for(auto& channel:channels)for(auto& filter:channel)filter.z1=filter.z2=0;
        buckets.fill(0);
        index=count=frames=0;
        energy=total=0;
        level.store(-std::numeric_limits<float>::infinity(),std::memory_order_relaxed);
    }

    void push(float left,float right,bool stereo) noexcept {
        energy+=weightedEnergy(left,channels[0]);
        if(stereo)energy+=weightedEnergy(right,channels[1]);
        if(++frames<framesPerBucket)return;
        total+=energy-buckets[index];
        buckets[index]=energy;
        index=(index+1)%buckets.size();
        if(count<buckets.size())++count;
        if(count==buckets.size()){
            const auto mean=total/(framesPerBucket*static_cast<double>(buckets.size()));
            level.store(mean>1e-12?static_cast<float>(-0.691+10*std::log10(mean)):-std::numeric_limits<float>::infinity(),
                        std::memory_order_relaxed);
        }
        frames=0;
        energy=0;
    }

    float lufs() const noexcept {return level.load(std::memory_order_relaxed);}
private:
    struct Biquad {
        double b0=1,b1=0,b2=0,a1=0,a2=0,z1=0,z2=0;
        double process(double sample) noexcept {
            const auto output=b0*sample+z1;
            z1=b1*sample-a1*output+z2;
            z2=b2*sample-a2*output;
            return output;
        }
    };
    static double weightedEnergy(float sample,std::array<Biquad,2>& filters) noexcept {
        const auto weighted=filters[1].process(filters[0].process(std::isfinite(sample)?sample:0.f));
        return weighted*weighted;
    }
    std::array<std::array<Biquad,2>,2> channels{};
    std::array<double,30> buckets{};
    std::size_t index=0,count=0;
    int frames=0,framesPerBucket=4800;
    double energy=0,total=0;
    std::atomic<float> level{-std::numeric_limits<float>::infinity()};
};
