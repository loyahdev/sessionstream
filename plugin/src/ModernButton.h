#pragma once
#include <jive_style_sheets/jive_style_sheets.h>
#include "StudioLookAndFeel.h"
#include "AccountAvatar.h"

namespace studio {
inline void drawSpinner(juce::Graphics& g,juce::Point<float> center,float radius,float width){
    const auto angle=float(std::fmod(juce::Time::getMillisecondCounterHiRes()*.004,juce::MathConstants<double>::twoPi));
    juce::Path arc;
    arc.addCentredArc(center.x,center.y,radius,radius,0,angle,angle+juce::MathConstants<float>::pi*1.45f,true);
    g.strokePath(arc,juce::PathStrokeType(width,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
}

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
    enum class Icon {none,copy,qr,link,play,account,settings,speaker,more,swap,users,stop,loading};
    ModernButton(){setMouseClickGrabsKeyboardFocus(false);refreshStyle();}
    void setAvatar(accountavatar::Bytes value){if(avatarBytes==value)return;avatarBytes=std::move(value);const auto loaded=avatarBytes?juce::ImageFileFormat::loadFrom(avatarBytes->getData(),avatarBytes->getSize()):juce::Image{};avatar=loaded.isValid()?loaded.rescaled(64,64,juce::Graphics::highResamplingQuality):juce::Image{};repaint();}
    void setIconOnly(bool value){if(iconOnly!=value){iconOnly=value;repaint();}}
    void setIcon(Icon value){if(icon!=value){icon=value;repaint();}}
    void setBadge(juce::String value,bool highlight=false){
        if(badgeText!=value||badgeHighlight!=highlight){badgeText=std::move(value);badgeHighlight=highlight;repaint();}
    }
    void setCountBadge(int value){if(countBadge!=value){countBadge=value;repaint();}}
    void refreshStyle(){
        const auto role=getProperties()["role"].toString();
        const bool filled=role=="primary"&&findColour(juce::TextButton::buttonColourId).getBrightness()>.65f;
        const auto key=role+(filled?"-filled":"-outlined")+(getToggleState()?"-on":"-off");
        if(key!=styleKey||skin==nullptr){
            styleKey=key;
            const bool quiet=role=="quiet",nav=role=="nav"||role=="mode",tab=role=="tab"||nav,segment=role=="segment",notice=role=="notice",accountPill=role=="account";
            const auto bg=role=="nav"?juce::Colours::transparentBlack:filled?accent
                :quiet?juce::Colours::transparentBlack
                :(tab||segment)?(getToggleState()?juce::Colour(0xff232f27):juce::Colours::transparentBlack)
                :accountPill?juce::Colour(0xff161e19)
                :notice?juce::Colour(0xff202824)
                :getToggleState()?juce::Colour(0xff2a382d):juce::Colour(0xff222c25);
            const auto fg=role=="nav"?(getToggleState()?studio::text:muted):role=="danger"?warm:filled?background:(tab||segment)?(getToggleState()?accent:muted):studio::text;
            const auto borderCol=role=="danger"?warm:filled?accent:(tab||segment)?(getToggleState()?juce::Colour(0xff394b3e):juce::Colours::transparentBlack):line;
            auto colour=[](juce::Colour c){return c.isTransparent()?juce::String("rgba(0,0,0,0)"):"#"+c.toDisplayString(false);};
            state.setProperty("border-width",quiet||nav?0:((tab||segment)&&!getToggleState())?0:1,nullptr);
            state.setProperty("style",new jive::Object{
                {"background",colour(bg)},{"foreground",colour(fg)},
                {"border",colour(borderCol)},{"border-radius",nav?0:notice?12:accountPill?6:4},
                {"hover",new jive::Object{{"background",colour(role=="nav"?juce::Colours::transparentBlack:filled?accent.brighter(.07f):quiet?juce::Colour(0xff222d25):(tab||segment)?(getToggleState()?juce::Colour(0xff29382e):juce::Colour(0xff1a231d)):juce::Colour(0xff2b382f))},{"border",colour(filled?accent:juce::Colour(0xff485a4c))}}},
                {"active",new jive::Object{{"background",colour(role=="nav"?juce::Colours::transparentBlack:filled?accent.darker(.12f):juce::Colour(0xff19231c))}}},
                {"focus",new jive::Object{{"border",colour(accountPill?line:accent)},{"background",colour(role=="nav"?juce::Colours::transparentBlack:filled?accent:juce::Colour(0xff26332a))}}},
                {"checked",new jive::Object{{"background",colour(role=="nav"?juce::Colours::transparentBlack:juce::Colour(0xff253329))},{"foreground",colour(role=="nav"?studio::text:accent)}}},
                {"disabled",new jive::Object{{"background",colour(quiet||tab||segment?juce::Colours::transparentBlack:juce::Colour(0xff1c241e))},{"foreground",colour(juce::Colour(0xff5f6e62))},{"border",colour(quiet||tab||segment?juce::Colours::transparentBlack:juce::Colour(0xff273029))}}}
            },nullptr);
            if(skin==nullptr)skin=jive::StyleSheet::create(*this,state);
        }
        state.setProperty("enabled",isEnabled(),nullptr);state.setProperty("toggled",getToggleState(),nullptr);
    }
    void paint(juce::Graphics&) override {}
    void paintOverChildren(juce::Graphics& g) override {
        const auto role=getProperties()["role"].toString();
        const auto ink=skin->getForeground().getColour().value_or(studio::text);
        const auto type=font(role=="primary"?12.5f:(role=="tab"||role=="segment")?11.5f:12.f,true);
        g.setColour(ink);g.setFont(type);
        if(role=="account"&&keyboardFocus&&hasKeyboardFocus(false)){g.setColour(violet);g.fillRect(9,getHeight()-3,getWidth()-18,1);g.setColour(ink);}
        if((role=="nav"||role=="mode")&&getToggleState()){g.setColour(role=="mode"?accent:violet);g.fillRect(0,getHeight()-2,getWidth(),2);g.setColour(ink);}
        auto bounds=getLocalBounds().toFloat().reduced(role=="nav"&&icon==Icon::none?0.f:role=="tab"||role=="segment"?6.f:9.f,2.f);
        if(icon!=Icon::none&&(iconOnly||getButtonText().isEmpty())&&badgeText.isEmpty()&&countBadge<=0){
            paintIcon(g,{bounds.getCentreX()-7.5f,bounds.getCentreY()-7.5f,15.f,15.f});
            return;
        }
        if(badgeText.isNotEmpty()){
            const auto badgeFont=font(9.5f,true);
            juce::GlyphArrangement bglyph;bglyph.addLineOfText(badgeFont,badgeText,0,0);
            const float bw=juce::jmax(28.f,std::ceil(bglyph.getBoundingBox(0,-1,true).getWidth())+11.f);
            const float bh=16.f;
            auto pill=juce::Rectangle<float>(bounds.getRight()-bw,bounds.getCentreY()-bh*.5f,bw,bh);
            g.setColour(badgeHighlight?violet.withAlpha(.16f):juce::Colour(0xff222c25));
            g.fillRoundedRectangle(pill,4.f);
            g.setColour(badgeHighlight?violet.withAlpha(.45f):line);
            g.drawRoundedRectangle(pill,4.f,1.f);
            g.setColour(badgeHighlight?violet:muted);
            g.setFont(badgeFont);
            g.drawText(badgeText,pill.toNearestInt(),juce::Justification::centred,false);
            bounds.removeFromRight(bw+6.f);
            g.setColour(ink);g.setFont(type);
        }
        if(countBadge>0){
            const auto badgeStr=countBadge>9?juce::String("9+"):juce::String(countBadge);
            const auto badgeFont=font(9.5f,true);
            const float bw=countBadge>9?20.f:15.f,bh=15.f;
            auto pill=juce::Rectangle<float>(bounds.getRight()-bw+1.f,bounds.getCentreY()-bh*.5f,bw,bh);
            g.setColour(accent);
            g.fillRoundedRectangle(pill,7.5f);
            g.setColour(background);
            g.setFont(badgeFont);
            g.drawText(badgeStr,pill.toNearestInt(),juce::Justification::centred,false);
            bounds.removeFromRight(bw+4.f);
            g.setColour(ink);g.setFont(type);
        }
        if(icon!=Icon::none){
            juce::GlyphArrangement glyph;glyph.addLineOfText(type,getButtonText(),0,0);
            const float side=role=="account"?20.f:14.f,gap=role=="account"?26.f:19.f;
            const float textWidth=juce::jmin(bounds.getWidth()-gap,glyph.getBoundingBox(0,-1,true).getWidth());
            const float start=badgeText.isNotEmpty()?bounds.getX():bounds.getCentreX()-(textWidth+gap)*.5f;
            paintIcon(g,{start,bounds.getCentreY()-side*.5f,side,side});
            bounds.setLeft(start+gap);
        }
        if(!iconOnly)g.drawFittedText(getButtonText(),bounds.toNearestInt(),(icon==Icon::none&&badgeText.isEmpty()&&role!="nav")?juce::Justification::centred:juce::Justification::centredLeft,1);
    }
    void focusGained(juce::Component::FocusChangeType cause) override{keyboardFocus=cause==juce::Component::focusChangedByTabKey;juce::TextButton::focusGained(cause);repaint();}
    void focusLost(juce::Component::FocusChangeType cause) override{keyboardFocus=false;juce::TextButton::focusLost(cause);repaint();}
private:
    accountavatar::Bytes avatarBytes;juce::Image avatar;
    bool keyboardFocus=false;
    juce::ValueTree state{"Button"};jive::StyleSheet::ReferenceCountedPointer skin;juce::String styleKey,badgeText;bool badgeHighlight=false,iconOnly=false;int countBadge=0;Icon icon=Icon::none;
    void paintIcon(juce::Graphics& g,juce::Rectangle<float> a){
        if(icon==Icon::loading){g.setColour(violet);drawSpinner(g,a.getCentre(),a.getWidth()*.28f,1.5f);return;}
        if(icon==Icon::account&&avatar.isValid()){juce::Graphics::ScopedSaveState saved(g);juce::Path circle;circle.addEllipse(a);g.reduceClipRegion(circle);g.drawImage(avatar,a,juce::RectanglePlacement::fillDestination);return;}
        juce::Graphics::ScopedSaveState saved(g);g.addTransform(juce::AffineTransform::scale(a.getWidth()/16.f).translated(a.getX(),a.getY()));
        const juce::PathStrokeType stroke(1.25f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded);
        juce::Path p;
        if(icon==Icon::more){
            for(float cx:{3.6f,8.f,12.4f})g.fillEllipse(cx-1.3f,8.f-1.3f,2.6f,2.6f);
            return;
        }
        if(icon==Icon::stop){g.fillRoundedRectangle(3.5f,3.5f,9,9,1);return;}
        if(icon==Icon::users){g.drawEllipse(3,1.5f,5,5,1.2f);p.startNewSubPath(1,14);p.lineTo(1,12);p.cubicTo(1,7,10,7,10,12);p.lineTo(10,14);p.startNewSubPath(11,2);p.cubicTo(16,2,16,7,11,7);p.startNewSubPath(12,9);p.cubicTo(16,9,16,12,16,14);}
        if(icon==Icon::swap){
            p.startNewSubPath(2.5f,5.5f);p.lineTo(13.f,5.5f);p.startNewSubPath(10.f,2.8f);p.lineTo(13.2f,5.5f);p.lineTo(10.f,8.2f);
            p.startNewSubPath(13.5f,10.5f);p.lineTo(3.f,10.5f);p.startNewSubPath(6.f,7.8f);p.lineTo(2.8f,10.5f);p.lineTo(6.f,13.2f);
        }
        if(icon==Icon::settings){for(int i=0;i<8;++i){const float ang=i*juce::MathConstants<float>::pi/4;g.drawLine(8+std::sin(ang)*5,8+std::cos(ang)*5,8+std::sin(ang)*7,8+std::cos(ang)*7,1.5f);}g.drawEllipse(3,3,10,10,1.4f);g.drawEllipse(6,6,4,4,1.2f);}
        if(icon==Icon::speaker){p.startNewSubPath(2,6);p.lineTo(5,6);p.lineTo(9,3);p.lineTo(9,13);p.lineTo(5,10);p.lineTo(2,10);p.closeSubPath();if(getToggleState()){p.startNewSubPath(12,6);p.lineTo(15,10);p.startNewSubPath(12,10);p.lineTo(15,6);}else{p.startNewSubPath(12,5);p.quadraticTo(16,8,12,11);}}
        if(icon==Icon::copy){g.drawRoundedRectangle(5,5,9,9,1.5f,1.2f);p.startNewSubPath(10,2);p.lineTo(3,2);p.quadraticTo(2,2,2,3);p.lineTo(2,10);}
        if(icon==Icon::qr){
            for(auto corner:{juce::Point<float>{1,1},{9,1},{1,9}}){
                g.drawRect(juce::Rectangle<float>(corner.x,corner.y,6,6),1.f);
                g.fillRect(corner.x+2,corner.y+2,2.f,2.f);
            }
            g.fillRect(9.f,9.f,2.f,2.f);g.fillRect(13.f,9.f,2.f,2.f);
            g.fillRect(11.f,11.f,2.f,2.f);g.fillRect(9.f,13.f,2.f,2.f);g.fillRect(13.f,13.f,2.f,2.f);
        }
        if(icon==Icon::link){p.startNewSubPath(6,10);p.lineTo(10,6);p.startNewSubPath(6,5);p.lineTo(8,3);p.cubicTo(12,-1,17,4,13,8);p.lineTo(11,10);p.startNewSubPath(5,6);p.lineTo(3,8);p.cubicTo(-1,12,4,17,8,13);p.lineTo(10,11);}
        if(icon==Icon::play){if(getButtonText().containsIgnoreCase("pause")){g.fillRoundedRectangle(3,2,3.5f,12,1);g.fillRoundedRectangle(9.5f,2,3.5f,12,1);}else if(getButtonText().containsIgnoreCase("stop")||getButtonText()=="Disconnect")g.fillRoundedRectangle(3,3,10,10,1.5f);else{p.startNewSubPath(4,2);p.lineTo(13,8);p.lineTo(4,14);p.closeSubPath();}}
        if(icon==Icon::account){g.drawEllipse(5,1.5f,6,6,1.2f);p.startNewSubPath(2,14);p.cubicTo(2,8,14,8,14,14);}
        g.strokePath(p,stroke);
    }
};
}
