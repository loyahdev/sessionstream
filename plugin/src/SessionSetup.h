#pragma once
#include "ModernButton.h"
// An inline section inside the Settings tab. Opening Settings never creates a window or scrim.
class SessionSetup final : public juce::Component {
public:
    std::function<void(int)> onChange;
    std::function<void(bool)> onDelivery,onEncryption;
    SessionSetup(){
        const char* names[]={"Studio","Balanced","Phone"};const char* ids[]={"quality-studio","quality-balanced","quality-phone"};
        for(int i=0;i<3;++i){auto& b=buttons[size_t(i)];addAndMakeVisible(b);b.setButtonText(names[i]);b.setComponentID(ids[i]);b.getProperties().set("role","segment");b.onClick=[this,i]{quality=i;refresh();if(onChange)onChange(i);};}
        for(auto* button:{&direct,&cloud,&encryption})addAndMakeVisible(*button);
        direct.setButtonText("Direct");cloud.setButtonText("Cloud");encryption.setButtonText("End-to-end encryption");
        direct.getProperties().set("role","segment");cloud.getProperties().set("role","segment");encryption.getProperties().set("role","toggle");
        direct.setComponentID("delivery-direct");cloud.setComponentID("delivery-cloud");encryption.setComponentID("audio-encryption");
        direct.onClick=[this]{if(onDelivery)onDelivery(false);};cloud.onClick=[this]{if(onDelivery)onDelivery(true);};encryption.onClick=[this]{if(onEncryption)onEncryption(!encrypted);};
        encryption.setTooltip("Adds endpoint audio encryption to Cloud and Direct buffered audio. WebRTC and HTTPS connection encryption always stay on. End the session before changing this.");
        refresh();
    }
    void configure(int value,bool editable,bool pro=true){if(quality!=value||canEdit!=editable||paid!=pro){quality=value;canEdit=editable;paid=pro;refresh();}}
    void configureDelivery(bool value,bool secure,bool available){cloudSelected=value;encrypted=secure;cloudAvailable=available;encryption.setButtonText(secure?"End-to-end encryption: on":"End-to-end encryption: off");direct.setEnabled(canEdit);cloud.setVisible(available||value);cloud.setEnabled(canEdit&&available);encryption.setEnabled(canEdit);studio::syncToggleState(direct,!value);studio::syncToggleState(cloud,value);studio::syncToggleState(encryption,secure);direct.refreshStyle();cloud.refreshStyle();encryption.refreshStyle();}
    void resized()override{
        direct.setBounds(2,66,108,24);cloud.setBounds(112,66,110,24);encryption.setBounds(0,100,224,24);
        if(paid){
            for(int i=0;i<3;++i)buttons[size_t(i)].setBounds(2+i*73,20,71,24);
        }else{
            buttons[0].setBounds(99,20,62,24);
            buttons[1].setBounds(2,20,96,24);
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
        g.drawText("Audio delivery",0,48,getWidth(),16,juce::Justification::left);
    }
private:
    studio::ModernButton direct,cloud,encryption;bool cloudSelected=false,encrypted=true,cloudAvailable=false;
    int quality=1;bool canEdit=true,paid=true;std::array<studio::ModernButton,3> buttons;
    void refresh(){for(int i=0;i<3;++i){buttons[size_t(i)].setVisible(i==1||paid);studio::syncToggleState(buttons[size_t(i)],i==quality);buttons[size_t(i)].setEnabled(canEdit&&(i==1||paid));buttons[size_t(i)].setTooltip(i!=1&&!paid?"Pro quality preset":"");buttons[size_t(i)].refreshStyle();}resized();repaint();}
};
