#pragma once
#include <jive_style_sheets/jive_style_sheets.h>
#include "StudioLookAndFeel.h"

namespace studio {
// This JUCE build ignores setToggleState while disabled. Model synchronization
// must still update locked/read-only controls, including their internal state.
inline void syncToggleState(juce::Button& button,bool value){
    if(button.getToggleState()==value)return;
    const bool enabled=button.isEnabled();if(!enabled)button.setEnabled(true);
    button.setToggleState(value,juce::dontSendNotification);
    if(!enabled)button.setEnabled(false);
}

// Keep JUCE's native button semantics/accessibility and existing callbacks.
// JIVE owns the skin and hover/press/focus/disabled selectors. Text and icons
// paint above its background canvas, using the shared embedded typeface.
class ModernButton final : public juce::TextButton {
public:
    enum class Icon {none,copy,qr,link,play,account,settings,speaker};
    ModernButton(){refreshStyle();}
    void setIcon(Icon value){if(icon!=value){icon=value;repaint();}}
    void refreshStyle(){
        const auto role=getProperties()["role"].toString();
        const bool filled=role=="primary"&&findColour(juce::TextButton::buttonColourId).getBrightness()>.65f;
        const auto key=role+(filled?"-filled":"-outlined");
        if(key!=styleKey||skin==nullptr){
            styleKey=key;
            const bool quiet=role=="quiet",tab=role=="tab";
            const auto bg=filled?accent:quiet||tab?juce::Colours::transparentBlack:juce::Colour(0xff263129);
            const auto fg=role=="danger"?warm:filled?background:studio::text;
            auto colour=[](juce::Colour c){return c.isTransparent()?juce::String("rgba(0,0,0,0)"):"#"+c.toDisplayString(false);};
            state.setProperty("border-width",quiet||tab?0:1,nullptr);
            state.setProperty("style",new jive::Object{
                {"background",colour(bg)},{"foreground",colour(fg)},
                {"border",colour(filled?accent:line)},{"border-radius",5},
                {"hover",new jive::Object{{"background",colour(filled?accent.brighter(.08f):juce::Colour(0xff303e33))},{"border",colour(juce::Colour(0xff51634f))}}},
                {"active",new jive::Object{{"background",colour(filled?accent.darker(.12f):juce::Colour(0xff1c281f))}}},
                {"focus",new jive::Object{{"border",colour(accent)},{"background",colour(filled?accent:juce::Colour(0xff303e33))}}},
                {"checked",new jive::Object{{"background",colour(juce::Colour(0xff303e2d))},{"foreground",colour(accent)}}},
                {"disabled",new jive::Object{{"background",colour(quiet||tab?juce::Colours::transparentBlack:juce::Colour(0xff202a22))},{"foreground",colour(juce::Colour(0xff68776b))},{"border",colour(juce::Colour(0xff2b352d))}}}
            },nullptr);
            if(skin==nullptr)skin=jive::StyleSheet::create(*this,state);
        }
        state.setProperty("enabled",isEnabled(),nullptr);state.setProperty("toggled",getToggleState(),nullptr);
    }
    void paint(juce::Graphics&) override {}
    void paintOverChildren(juce::Graphics& g) override {
        const auto ink=skin->getForeground().getColour().value_or(studio::text);
        const auto type=font(getProperties()["role"].toString()=="primary"?12.5f:12.f);
        g.setColour(ink);g.setFont(type);
        auto bounds=getLocalBounds().toFloat().reduced(10,2);
        if(icon!=Icon::none&&getButtonText().isEmpty()){paintIcon(g,{bounds.getCentreX()-7,bounds.getCentreY()-7,14,14});return;}
        if(icon!=Icon::none){
            juce::GlyphArrangement glyph;glyph.addLineOfText(type,getButtonText(),0,0);
            const float textWidth=juce::jmin(bounds.getWidth()-21,glyph.getBoundingBox(0,-1,true).getWidth());
            const float start=bounds.getCentreX()-(textWidth+21)*.5f;
            paintIcon(g,{start,bounds.getCentreY()-7,14,14});
            bounds.setLeft(start+21);
        }
        g.drawFittedText(getButtonText(),bounds.toNearestInt(),icon==Icon::none?juce::Justification::centred:juce::Justification::centredLeft,1);
    }
private:
    juce::ValueTree state{"Button"};jive::StyleSheet::ReferenceCountedPointer skin;juce::String styleKey;Icon icon=Icon::none;
    void paintIcon(juce::Graphics& g,juce::Rectangle<float> a){
        juce::Graphics::ScopedSaveState saved(g);g.addTransform(juce::AffineTransform::scale(a.getWidth()/16).translated(a.getX(),a.getY()));
        const juce::PathStrokeType stroke(1.25f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded);
        juce::Path p;
        if(icon==Icon::settings){for(int i=0;i<8;++i){const float a=i*juce::MathConstants<float>::pi/4;g.drawLine(8+std::sin(a)*5,8+std::cos(a)*5,8+std::sin(a)*7,8+std::cos(a)*7,1.5f);}g.drawEllipse(3,3,10,10,1.4f);g.drawEllipse(6,6,4,4,1.2f);}
        if(icon==Icon::speaker){p.startNewSubPath(2,6);p.lineTo(5,6);p.lineTo(9,3);p.lineTo(9,13);p.lineTo(5,10);p.lineTo(2,10);p.closeSubPath();if(getToggleState()){p.startNewSubPath(12,6);p.lineTo(15,10);p.startNewSubPath(12,10);p.lineTo(15,6);}else{p.startNewSubPath(12,5);p.quadraticTo(16,8,12,11);}}
        if(icon==Icon::copy){g.drawRoundedRectangle(5,5,9,9,1.5f,1.2f);p.startNewSubPath(10,2);p.lineTo(3,2);p.quadraticTo(2,2,2,3);p.lineTo(2,10);}
        if(icon==Icon::qr){for(auto area:{juce::Rectangle<float>(2,2,4,4),{10,2,4,4},{2,10,4,4}})g.drawRect(area,1.2f);g.fillRect(10,10,2,2);g.fillRect(12,12,2,2);g.fillRect(10,14,2,1);}
        if(icon==Icon::link){p.startNewSubPath(6,10);p.lineTo(10,6);p.startNewSubPath(6,5);p.lineTo(8,3);p.cubicTo(12,-1,17,4,13,8);p.lineTo(11,10);p.startNewSubPath(5,6);p.lineTo(3,8);p.cubicTo(-1,12,4,17,8,13);p.lineTo(10,11);}
        if(icon==Icon::play){if(getButtonText().containsIgnoreCase("pause")){g.fillRoundedRectangle(3,2,3.5f,12,1);g.fillRoundedRectangle(9.5f,2,3.5f,12,1);}else if(getButtonText().containsIgnoreCase("stop")||getButtonText()=="Disconnect")g.fillRoundedRectangle(3,3,10,10,1.5f);else{p.startNewSubPath(4,2);p.lineTo(13,8);p.lineTo(4,14);p.closeSubPath();}}
        if(icon==Icon::account){g.drawEllipse(5,1.5f,6,6,1.2f);p.startNewSubPath(2,14);p.cubicTo(2,8,14,8,14,14);}
        g.strokePath(p,stroke);
    }
};
}
