#pragma once
#include "ModernButton.h"
// An inline section inside the Settings tab. Opening Settings never creates a window or scrim.
class SessionSetup final : public juce::Component {
public:
    std::function<void(int)> onChange;
    SessionSetup(){
        const char* names[]={"Studio","Balanced","Phone"};const char* ids[]={"quality-studio","quality-balanced","quality-phone"};
        for(int i=0;i<3;++i){auto& b=buttons[size_t(i)];addAndMakeVisible(b);b.setButtonText(names[i]);b.setComponentID(ids[i]);b.getProperties().set("role","segment");b.onClick=[this,i]{quality=i;refresh();if(onChange)onChange(i);};}
        refresh();
    }
    void configure(int value,bool editable,bool pro=true){if(quality!=value||canEdit!=editable||paid!=pro){quality=value;canEdit=editable;paid=pro;refresh();}}
    void resized()override{
        if(paid){
            for(int i=0;i<3;++i)buttons[size_t(i)].setBounds(2+i*73,20,71,24);
        }else{
            buttons[0].setBounds(2,20,96,24);
            buttons[1].setBounds(99,20,62,24);
            buttons[2].setBounds(162,20,60,24);
        }
    }
    void paint(juce::Graphics& g)override{
        using namespace studio;
        g.setColour(muted);g.setFont(font(10));
        g.drawText("Stream quality",0,0,getWidth(),16,juce::Justification::left);
        const float trackW=paid?static_cast<float>(getWidth()):100.f;
        juce::Rectangle<float> track{.5f,18.5f,trackW-1.f,27.f};
        g.setColour(inset);g.fillRoundedRectangle(track,6.f);
        g.setColour(line);g.drawRoundedRectangle(track,6.f,1.f);
        g.setColour(muted);g.setFont(font(10));
        g.drawFittedText(quality==0?juce::String::fromUTF8("510 kbps stereo \xC2\xB7 Full studio detail."):quality==1?juce::String::fromUTF8("320 kbps stereo \xC2\xB7 Less data for long sessions."):juce::String::fromUTF8("96 kbps stereo \xC2\xB7 Optimized for mobile data."),0,50,getWidth(),24,juce::Justification::topLeft,2);
    }
private:
    int quality=0;bool canEdit=true,paid=true;std::array<studio::ModernButton,3> buttons;
    void refresh(){for(int i=0;i<3;++i){buttons[size_t(i)].setVisible(i==0||paid);studio::syncToggleState(buttons[size_t(i)],i==quality);buttons[size_t(i)].setEnabled(canEdit&&(i==0||paid));buttons[size_t(i)].setTooltip(i>0&&!paid?"Pro quality preset":"");buttons[size_t(i)].refreshStyle();}resized();repaint();}
};
