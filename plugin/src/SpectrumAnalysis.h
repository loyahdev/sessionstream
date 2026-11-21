#pragma once
#include <array>
#include <algorithm>
#include <cmath>

namespace spectrum {
// Gaussian averaging in frequency, with a minimum width of 0.75 FFT bins.
// Fractional bin centres avoid repeated low-bin plateaus on the log axis;
// constant relative bandwidth gives the treble the same visual resolution.
template<size_t Points,size_t Bins>
std::array<float,Points> logBands(const std::array<float,Bins>& power,double rate,int fftSize){
    std::array<float,Points> result{};
    for(size_t i=0;i<Points;++i){
        const double hz=20*std::pow(1000.,double(i)/(Points-1));
        if(hz>=rate*.5){result[i]=-84;continue;}
        const double centre=hz*fftSize/rate,sigma=std::max(.75,centre*.028);
        const int first=std::max(1,int(std::floor(centre-3*sigma))),last=std::min(int(Bins)-1,int(std::ceil(centre+3*sigma)));
        double sum=0,weight=0;
        for(int bin=first;bin<=last;++bin){const double offset=(bin-centre)/sigma,w=std::exp(-.5*offset*offset);sum+=std::max(0.f,power[size_t(bin)])*w;weight+=w;}
        result[i]=weight>0?float(std::max(-84.,10*std::log10(std::max(1e-12,sum/weight)))):-84.f;
    }
    return result;
}
}
