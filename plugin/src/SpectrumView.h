#pragma once
#include <juce_dsp/juce_dsp.h>
#include "SignalCapture.h"
#include "SpectrumAnalysis.h"
#include "StudioLookAndFeel.h"
class SpectrumView final : public juce::Component {
public:
    SpectrumView(){setInterceptsMouseClicks(false,false);}
    void setReceiving(bool value){if(receivingMode!=value){receivingMode=value;repaint();}}
    void update(SignalCapture& capture,double sampleRate){
        rate=sampleRate;bool fresh=false;
        capture.drain([&](SignalCapture::Frame f){left[cursor]=f.left;right[cursor]=f.right;cursor=(cursor+1)%size;fresh=true;});
        std::array<float,points> next{};next.fill(-84.f);
        if(fresh){
            power.fill(0);
            for(int ch=0;ch<2;++ch){
                data.fill(0);const auto& samples=ch?right:left;
                for(int i=0;i<size;++i)data[i]=samples[(cursor+i)%size];
                window.multiplyWithWindowingTable(data.data(),size);fft.performFrequencyOnlyForwardTransform(data.data());
                for(int bin=1;bin<=size/2;++bin){const float amplitude=data[bin]*4.f/size;power[bin]=juce::jmax(power[bin],amplitude*amplitude);}
            }
            next=spectrum::logBands<points>(power,rate,size);
        }
        float peakDb=-84.f;
        for(int i=0;i<points;++i){
            trace[i]+=(next[i]-trace[i])*(next[i]>trace[i]?.72f:.18f);
            peakDb=juce::jmax(peakDb,trace[i]);
        }
        const float targetIdle=peakDb<=-78.5f?1.f:0.f;
        idleAlpha+=(targetIdle-idleAlpha)*(targetIdle>idleAlpha?.08f:.35f);
        repaint();
    }
    void paint(juce::Graphics& g) override {
        using namespace studio;auto area=getLocalBounds().toFloat();
        auto plot=area.withTrimmedTop(40).withTrimmedBottom(28).withTrimmedRight(30);
        g.setFont(font(9));
        for(int db=-72;db<=0;db+=12){float y=plot.getBottom()-(db+84)/84.f*plot.getHeight();g.setColour(line.withAlpha(.6f));g.drawHorizontalLine(int(y),plot.getX(),plot.getRight());g.setColour(muted.withAlpha(.58f));g.drawText(juce::String(db),int(plot.getRight()+5),int(y-6),29,12,juce::Justification::left);}
        for(int freq:{20,50,100,200,500,1000,2000,5000,10000,20000}){float x=plot.getX()+std::log(double(freq)/20)/std::log(1000.)*plot.getWidth();g.setColour(line.withAlpha(.6f));g.drawVerticalLine(int(x),plot.getY(),plot.getBottom());g.setColour(muted.withAlpha(.68f));g.drawText(freq>=1000?juce::String(freq/1000)+"k":juce::String(freq),juce::jlimit(0,getWidth()-32,int(x-16)),int(plot.getBottom()+9),32,14,juce::Justification::centred);}
        juce::Path curve;
        auto point=[&](int i){return juce::Point<float>{plot.getX()+float(i)/(points-1)*plot.getWidth(),plot.getBottom()-juce::jlimit(0.f,1.f,(trace[i]+84)/84.f)*plot.getHeight()};};
        auto previous=point(0);curve.startNewSubPath(previous);
        for(int i=1;i<points;++i){const auto current=point(i);curve.quadraticTo(previous,(previous+current)*.5f);previous=current;}
        curve.lineTo(previous);
        auto fill=curve;fill.lineTo(plot.getRight(),plot.getBottom());fill.lineTo(plot.getX(),plot.getBottom());fill.closeSubPath();g.setGradientFill(juce::ColourGradient(accent.withAlpha(.17f),0,plot.getY(),accent.withAlpha(.01f),0,plot.getBottom(),false));g.fillPath(fill);
        g.setColour(accent.withAlpha(.9f));g.strokePath(curve,juce::PathStrokeType(1.3f));
        if(idleAlpha>.03f){
            const float a=juce::jlimit(0.f,1.f,idleAlpha);
            auto badge=juce::Rectangle<float>(plot.getCentreX()-116.f,plot.getCentreY()-17.f,232.f,34.f);
            g.setColour(juce::Colour(0xff141c17).withAlpha(.92f*a));
            g.fillRoundedRectangle(badge,6.f);
            g.setColour(line.withAlpha(.8f*a));
            g.drawRoundedRectangle(badge,6.f,1.f);
            g.setColour(text.withAlpha(.82f*a));
            g.setFont(font(11.5f,true));
            g.drawText(receivingMode?"Waiting for incoming stream":"Play audio in your DAW",badge.toNearestInt(),juce::Justification::centred,false);
        }
        g.setColour(muted);g.setFont(font(14,true));g.drawText("Spectrum",0,6,150,20,juce::Justification::left);g.setFont(font(9.5f));g.drawText(juce::String(rate/1000,1)+juce::String::fromUTF8(" kHz  \xC2\xB7  Stereo"),getWidth()-170,8,162,16,juce::Justification::right);

    }
private:
    static constexpr int size=16384,points=280;
    juce::dsp::FFT fft{14};juce::dsp::WindowingFunction<float> window{size,juce::dsp::WindowingFunction<float>::hann,false};
    std::array<float,size> left{},right{};std::array<float,size*2> data{};std::array<float,size/2+1> power{};
    std::array<float,points> trace=[] {std::array<float,points> a{};a.fill(-84);return a;}();
    int cursor=0;double rate=48000;float idleAlpha=1.f;bool receivingMode=false;
};
