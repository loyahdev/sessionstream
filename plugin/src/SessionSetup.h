#pragma once
#include "ModernButton.h"
#include "StreamFormat.h"
class SessionSetup final : public juce::Component {
public:
    std::function<void(int,int)> onChange;
    std::function<void(bool)> onDelivery,onEncryption;
    SessionSetup(){
        for(auto* combo:{&format,&channels,&delivery})addAndMakeVisible(combo);
        format.setComponentID("stream-format");format.setTitle("Codec and bitrate or bit depth");channels.setComponentID("stream-channels");channels.setTitle("Channel layout");
        const int order[]={2,3,4,5,1,0,6,7,8};for(int index:order)format.addItem(streamformat::names[index],index+1);
        channels.addItem("Mono",1);channels.addItem("Stereo",2);channels.addItem("5.1",6);channels.addItem("7.1",8);delivery.addItem("Direct",1);delivery.setComponentID("audio-delivery");delivery.setTitle("Audio delivery");delivery.onChange=[this]{if(onDelivery)onDelivery(delivery.getSelectedId()==2);};
        format.onChange=[this]{quality=format.getSelectedId()-1;if(!streamformat::pcm(quality)&&channelCount>2)channelCount=2;refresh();if(onChange)onChange(quality,channelCount);};
        channels.onChange=[this]{channelCount=channels.getSelectedId();refresh();if(onChange)onChange(quality,channelCount);};
        addAndMakeVisible(encryption);
        encryption.setButtonText("End-to-end encryption");
        encryption.getProperties().set("role","toggle");
        encryption.setComponentID("audio-encryption");
        encryption.onClick=[this]{if(onEncryption)onEncryption(!encrypted);};
        encryption.setTooltip("Endpoint encryption for Cloud and Direct PCM. HTTPS and WebRTC connection encryption always remain enabled.");
        refresh();
    }
    void configure(int value,int count,int inputs,bool editable,bool pro=true){if(quality!=value||channelCount!=count||inputChannels!=inputs||canEdit!=editable||paid!=pro){quality=value;channelCount=count;inputChannels=inputs;canEdit=editable;paid=pro;refresh();}}
    void configureDelivery(bool value,bool secure,bool available){encrypted=secure;encryption.setButtonText(secure?"End-to-end encryption: on":"End-to-end encryption: off");if(available||value){if(delivery.indexOfItemId(2)<0)delivery.addItem("Cloud",2);}else if(delivery.indexOfItemId(2)>=0){delivery.clear(juce::dontSendNotification);delivery.addItem("Direct",1);}delivery.setItemEnabled(2,available);delivery.setSelectedId(value?2:1,juce::dontSendNotification);delivery.setEnabled(canEdit);encryption.setEnabled(canEdit);studio::syncToggleState(encryption,secure);encryption.refreshStyle();}
    void resized()override{format.setBounds(0,18,getWidth(),28);channels.setBounds(0,66,108,28);delivery.setBounds(116,66,108,28);encryption.setBounds(0,104,getWidth(),24);}
    void paint(juce::Graphics& g)override{g.setColour(studio::muted);g.setFont(studio::font(10));g.drawText("Format",0,0,getWidth(),16,juce::Justification::left);g.drawText("Channels",0,48,getWidth(),16,juce::Justification::left);g.drawText("Delivery",116,48,108,16,juce::Justification::left);}
private:
    juce::ComboBox format,channels,delivery;studio::ModernButton encryption;bool encrypted=true;
    int quality=1,channelCount=2,inputChannels=2;bool canEdit=true,paid=true;
    void refresh(){for(int i=0;i<9;++i)format.setItemEnabled(i+1,paid||i==1);format.setSelectedId(quality+1,juce::dontSendNotification);format.setEnabled(canEdit&&paid);for(int count:{1,2,6,8})channels.setItemEnabled(count,(paid||count==2)&&(count<=2||(streamformat::pcm(quality)&&inputChannels==count)));channels.setSelectedId(channelCount,juce::dontSendNotification);channels.setEnabled(canEdit&&paid);channels.setTooltip("Surround requires PCM and a matching 5.1 or 7.1 DAW bus. Channel order: L R C LFE Ls Rs Lrs Rrs.");resized();repaint();}
};
