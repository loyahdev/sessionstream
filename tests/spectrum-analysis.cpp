#include "../plugin/src/SpectrumAnalysis.h"
#include <cassert>
#include <iostream>
int main(){
 constexpr int size=16384,points=280;std::array<float,size/2+1> power{};
 auto silence=spectrum::logBands<points>(power,48000,size);for(float db:silence)assert(db==-84);
 // A smooth bass response must not turn into the old repeated-bin staircase.
 for(size_t bin=1;bin<power.size();++bin){double hz=bin*48000./size;power[bin]=float(.01*std::exp(-std::pow(std::log(hz/55.)/.45,2)));}
 auto bass=spectrum::logBands<points>(power,48000,size);int unchanged=0,peak=0;
 for(int i=1;i<70;++i){if(std::abs(bass[i]-bass[i-1])<.0001f)++unchanged;if(bass[i]>bass[peak])peak=i;assert(std::isfinite(bass[i]));}
 assert(unchanged<3);double peakHz=20*std::pow(1000.,double(peak)/(points-1));assert(peakHz>48&&peakHz<62);
 // Smoothing should preserve a broad flat response and suppress single-bin
 // treble spikes instead of drawing every spike at full amplitude.
 power.fill(.01f);auto flat=spectrum::logBands<points>(power,48000,size);for(float db:flat)assert(std::abs(db+20)<.01f);
 power[size_t(10000.*size/48000)]=1;auto spike=spectrum::logBands<points>(power,48000,size);assert(*std::max_element(spike.begin(),spike.end()) < -15);
 auto narrowRate=spectrum::logBands<points>(power,32000,size);assert(narrowRate.back()==-84);
 std::cout<<"PASS: continuous bass, accurate broad peak, flat response, treble smoothing, silence and Nyquist bound\n";
}
