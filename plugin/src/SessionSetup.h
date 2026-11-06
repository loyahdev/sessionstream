#pragma once
#include "ModernButton.h"
// An ordinary inline section. Opening Settings never creates a window or scrim.
class SessionSetup final : public juce::Component {
public:
    std::function<void(int)> onChange;
    SessionSetup(){
        const char* names[]={"Studio","Balanced","Phone"};const char* ids[]={"quality-studio","quality-balanced","quality-phone"};
        for(int i=0;i<3;++i){auto& b=buttons[size_t(i)];addAndMakeVisible(b);b.setButtonText(names[i]);b.setComponentID(ids[i]);b.getProperties().set("role","tab");b.onClick=[this,i]{quality=i;refresh();if(onChange)onChange(i);};}
        refresh();
    }
    void configure(int value,bool editable){if(quality!=value||canEdit!=editable){quality=value;canEdit=editable;refresh();}}
    void resized()override{for(int i=0;i<3;++i)buttons[size_t(i)].setBounds(i*77,18,70,28);}
    void paint(juce::Graphics& g)override{using namespace studio;g.setColour(muted);g.setFont(font(10));g.drawText("Live audio quality",0,0,getWidth(),16,juce::Justification::left);g.setFont(font(10));g.drawFittedText(quality==0?"Highest fidelity stereo.":quality==1?"High quality, less data.":"Lower data for mobile connections.",0,51,getWidth(),24,juce::Justification::topLeft,2);}
private:
    int quality=0;bool canEdit=true;std::array<studio::ModernButton,3> buttons;
    void refresh(){for(int i=0;i<3;++i){studio::syncToggleState(buttons[size_t(i)],i==quality);buttons[size_t(i)].setEnabled(canEdit);buttons[size_t(i)].refreshStyle();}repaint();}
};
