#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include "BinaryData.h"

namespace studio {
inline const juce::Colour background{0xff151a17}, panel{0xff1b221d}, inset{0xff111813}, line{0xff303b33},
    text{0xffe9eee8}, muted{0xff929e94}, accent{0xffbaf77a}, warm{0xffe9bb80};
inline juce::Font font(float size,bool bold=false){
    static const auto regular=juce::Typeface::createSystemTypefaceFor(BinaryData::DMSansRegular_ttf,BinaryData::DMSansRegular_ttfSize);
    static const auto semibold=juce::Typeface::createSystemTypefaceFor(BinaryData::DMSansSemibold_ttf,BinaryData::DMSansSemibold_ttfSize);
    return juce::Font(juce::FontOptions(bold?semibold:regular).withHeight(size));
}
inline juce::Font headingFont(float size,bool wordmark=false){
    static const auto medium=juce::Typeface::createSystemTypefaceFor(BinaryData::ManropeMedium_ttf,BinaryData::ManropeMedium_ttfSize);
    static const auto brand=juce::Typeface::createSystemTypefaceFor(BinaryData::ManropeWordmark_ttf,BinaryData::ManropeWordmark_ttfSize);
    return juce::Font(juce::FontOptions(wordmark?brand:medium).withHeight(size));
}

class Look final : public juce::LookAndFeel_V4 {
public:
    juce::Typeface::Ptr getTypefaceForFont(const juce::Font& requested)override{return font(requested.getHeight(),requested.isBold()).getTypefacePtr();}
    Look(){
        setColour(juce::TextButton::buttonColourId,panel);setColour(juce::TextButton::textColourOffId,text);
        setColour(juce::TextEditor::backgroundColourId,inset);setColour(juce::TextEditor::textColourId,text);
        setColour(juce::TextEditor::highlightColourId,accent.withAlpha(.25f));setColour(juce::CaretComponent::caretColourId,accent);
        setColour(juce::ComboBox::backgroundColourId,inset);setColour(juce::ComboBox::textColourId,text);setColour(juce::ComboBox::outlineColourId,line);
        setColour(juce::PopupMenu::backgroundColourId,panel);setColour(juce::PopupMenu::textColourId,text);setColour(juce::PopupMenu::highlightedBackgroundColourId,accent);setColour(juce::PopupMenu::highlightedTextColourId,background);
        setColour(juce::Slider::textBoxTextColourId,text);setColour(juce::Slider::textBoxBackgroundColourId,inset);setColour(juce::Slider::textBoxOutlineColourId,line);
        setColour(juce::ToggleButton::textColourId,text);setColour(juce::ToggleButton::tickColourId,accent);setColour(juce::ToggleButton::tickDisabledColourId,muted);
    }
    void drawButtonBackground(juce::Graphics& g,juce::Button& button,const juce::Colour&,bool hover,bool down) override {
        auto area=button.getLocalBounds().toFloat().reduced(.5f);const auto role=button.getProperties()["role"].toString();
        auto fill=button.findColour(juce::TextButton::buttonColourId);
        if(role=="tab")fill=button.getToggleState()?juce::Colour(0xff344632):juce::Colours::transparentBlack;
        if(role=="quiet")fill=hover?juce::Colour(0xff28362b):juce::Colours::transparentBlack;
        if(!button.isEnabled())fill=role=="primary"?juce::Colour(0xff29352c):fill.withMultipliedAlpha(.4f);else if(down)fill=fill.darker(.1f);else if(hover&&role!="quiet")fill=fill.brighter(.07f);
        g.setColour(fill);g.fillRoundedRectangle(area,5.f);
        if(role!="quiet"){g.setColour(role=="primary"?fill:line.withAlpha(button.isEnabled()?1.f:.4f));g.drawRoundedRectangle(area,5.f,1.f);}
    }
    void drawButtonText(juce::Graphics& g,juce::TextButton& button,bool,bool) override {
        auto colour=button.findColour(juce::TextButton::textColourOffId);
        if(button.getProperties()["role"].toString()=="tab")colour=button.getToggleState()?accent:muted;
        if(!button.isEnabled()&&button.getProperties()["role"].toString()=="primary")colour=muted;
        g.setColour(colour.withMultipliedAlpha(button.isEnabled()?1.f:.6f));g.setFont(font(button.getProperties()["role"].toString()=="primary"?13.f:12.f,true));
        g.drawFittedText(button.getButtonText(),button.getLocalBounds().reduced(9,2),juce::Justification::centred,1);
    }
    void fillTextEditorBackground(juce::Graphics& g,int width,int height,juce::TextEditor& editor) override {
        g.setColour(editor.findColour(juce::TextEditor::backgroundColourId));g.fillRoundedRectangle(.5f,.5f,width-1.f,height-1.f,5.f);
    }
    void drawTextEditorOutline(juce::Graphics& g,int width,int height,juce::TextEditor& editor) override {
        g.setColour(editor.hasKeyboardFocus(true)?accent.withAlpha(.8f):line.withAlpha(editor.isEnabled()?1.f:.4f));g.drawRoundedRectangle(.5f,.5f,width-1.f,height-1.f,5.f,1.f);
    }
    juce::Font getTextButtonFont(juce::TextButton&,int height) override{juce::ignoreUnused(height);return font(12.f,true);}
    juce::Font getComboBoxFont(juce::ComboBox&) override{return font(12.f);}
    juce::Font getLabelFont(juce::Label&) override{return font(12.f);}
    void drawComboBox(juce::Graphics& g,int width,int height,bool,int,int,int,int,juce::ComboBox& box) override {
        g.setColour(inset);g.fillRoundedRectangle(.5f,.5f,width-1.f,height-1.f,5.f);g.setColour(line);g.drawRoundedRectangle(.5f,.5f,width-1.f,height-1.f,5.f,1.f);
        juce::Path arrow;const float x=width-17.f,y=height*.5f;arrow.startNewSubPath(x-3,y-2);arrow.lineTo(x,y+1);arrow.lineTo(x+3,y-2);g.setColour(muted.withAlpha(box.isEnabled()?1.f:.4f));g.strokePath(arrow,juce::PathStrokeType(1.3f));
    }
    void positionComboBoxText(juce::ComboBox& box,juce::Label& label) override {
        label.setBounds(10,0,box.getWidth()-34,box.getHeight());label.setFont(font(12));label.setBorderSize(juce::BorderSize<int>());
    }
    juce::PopupMenu::Options getOptionsForComboBoxPopupMenu(juce::ComboBox& box,juce::Label&) override {
        return juce::PopupMenu::Options().withTargetComponent(&box).withParentComponent(box.getParentComponent()).withMinimumWidth(box.getWidth()).withStandardItemHeight(30).withInitiallySelectedItem(box.getSelectedId()).withPreferredPopupDirection(juce::PopupMenu::Options::PopupDirection::downwards);
    }
    juce::Font getPopupMenuFont() override{return font(12);}
    void drawPopupMenuBackground(juce::Graphics& g,int width,int height) override {
        g.fillAll(panel);g.setColour(line);g.drawRect(0,0,width,height,1);
    }
    void getIdealPopupMenuItemSize(const juce::String& value,bool separator,int,int& width,int& height) override {
        juce::GlyphArrangement glyphs;glyphs.addLineOfText(font(12),value,0,0);width=juce::jmax(140,juce::roundToInt(glyphs.getBoundingBox(0,-1,true).getWidth())+52);height=separator?9:30;
    }
    void drawPopupMenuItem(juce::Graphics& g,const juce::Rectangle<int>& area,bool separator,bool enabled,bool highlighted,bool ticked,bool submenu,const juce::String& value,const juce::String& shortcut,const juce::Drawable*,const juce::Colour*) override {
        if(separator){g.setColour(line);g.drawHorizontalLine(area.getCentreY(),area.getX()+10.f,area.getRight()-10.f);return;}
        if(highlighted&&enabled){g.setColour(accent.withAlpha(.12f));g.fillRoundedRectangle(area.toFloat().reduced(4,2),4);}
        g.setColour((highlighted?accent:text).withAlpha(enabled?1.f:.4f));g.setFont(font(12));g.drawText(value,area.reduced(28,0),juce::Justification::centredLeft);
        if(ticked){g.setColour(accent);g.fillEllipse(area.getX()+12.f,area.getCentreY()-2.f,4,4);}
        if(submenu){juce::Path arrow;arrow.startNewSubPath(area.getRight()-15.f,area.getCentreY()-3.f);arrow.lineTo(area.getRight()-12.f,area.getCentreY());arrow.lineTo(area.getRight()-15.f,area.getCentreY()+3.f);g.strokePath(arrow,juce::PathStrokeType(1.2f));}
        if(shortcut.isNotEmpty()){g.setFont(font(10));g.setColour(muted);g.drawText(shortcut,area.reduced(12,0),juce::Justification::centredRight);}
    }
    juce::Label* createSliderTextBox(juce::Slider& slider) override {
        auto* label=juce::LookAndFeel_V4::createSliderTextBox(slider);label->getProperties().set("role","gain");label->setBorderSize(juce::BorderSize<int>());return label;
    }
    void drawLabel(juce::Graphics& g,juce::Label& label) override {
        if(label.getProperties()["role"].toString()!="gain"){juce::LookAndFeel_V4::drawLabel(g,label);return;}
        auto area=label.getLocalBounds().toFloat().reduced(.5f);g.setColour(inset);g.fillRoundedRectangle(area,5);g.setColour(label.isBeingEdited()?accent:line);g.drawRoundedRectangle(area,4,1);
        if(!label.isBeingEdited()){g.setColour(text);g.setFont(font(12));g.drawText(label.getText(),label.getLocalBounds().reduced(6,0),juce::Justification::centred);}
    }
    void drawRotarySlider(juce::Graphics& g,int x,int y,int width,int height,float pos,float start,float end,juce::Slider& slider) override {
        const float radius=juce::jmin(width,height)*.5f-6.5f,cx=x+width*.5f,cy=y+height*.5f+1.f,angle=start+pos*(end-start);
        const float unityProp=static_cast<float>(slider.valueToProportionOfLength(0.0));
        const float unityAngle=start+juce::jlimit(0.f,1.f,unityProp)*(end-start);
        const bool nearUnity=std::abs(slider.getValue())<.15;
        // 12-o'clock 0 dB unity reference tick outside the rotary arc
        g.setColour(nearUnity?accent:muted.withAlpha(.75f));
        g.drawLine(cx+std::sin(unityAngle)*(radius+2.5f),cy-std::cos(unityAngle)*(radius+2.5f),
                   cx+std::sin(unityAngle)*(radius+6.2f),cy-std::cos(unityAngle)*(radius+6.2f),1.5f);
        juce::Path ring;ring.addCentredArc(cx,cy,radius,radius,0,start,end,true);g.setColour(line);g.strokePath(ring,juce::PathStrokeType(2.3f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
        juce::Path value;value.addCentredArc(cx,cy,radius,radius,0,start,angle,true);g.setColour(accent);g.strokePath(value,juce::PathStrokeType(2.3f,juce::PathStrokeType::curved,juce::PathStrokeType::rounded));
        const auto disk=juce::Rectangle<float>(cx-radius+5,cy-radius+5,2*radius-10,2*radius-10);
        g.setColour(juce::Colours::black.withAlpha(.42f));g.fillEllipse(disk.translated(0,2.5f));
        g.setGradientFill(juce::ColourGradient(juce::Colour(0xff35433a),cx,cy-radius,juce::Colour(0xff151f19),cx,cy+radius,false));g.fillEllipse(disk);
        g.setColour(juce::Colour(0xff4c5d51));g.drawEllipse(disk,1.f);
        g.setColour(background.withAlpha(.65f));g.drawEllipse(disk.reduced(3.5f),1.f);
        g.setColour(accent);g.drawLine(cx+std::sin(angle)*(radius-14.5f),cy-std::cos(angle)*(radius-14.5f),cx+std::sin(angle)*(radius-7.5f),cy-std::cos(angle)*(radius-7.5f),2.3f);
    }
    void drawLinearSlider(juce::Graphics& g,int x,int y,int width,int height,float position,float,float,juce::Slider::SliderStyle,juce::Slider&) override {
        const float centre=y+height*.5f;g.setColour(line);g.fillRoundedRectangle(static_cast<float>(x),centre-2,static_cast<float>(width),4.f,2.f);
        g.setColour(accent);g.fillRoundedRectangle(static_cast<float>(x),centre-2,juce::jmax(1.f,position-x),4.f,2.f);
        g.setColour(background);g.fillEllipse(position-8,centre-8,16,16);g.setColour(accent);g.fillEllipse(position-5,centre-5,10,10);
    }
    void drawToggleButton(juce::Graphics& g,juce::ToggleButton& button,bool hover,bool) override {
        const auto alpha=button.isEnabled()?1.f:.4f;auto box=juce::Rectangle<float>(1,button.getHeight()*.5f-8,16,16);
        g.setColour(button.getToggleState()?accent:inset);g.fillRoundedRectangle(box,4.f);g.setColour(hover?accent:line);g.drawRoundedRectangle(box,4.f,1.f);
        if(button.getToggleState()){juce::Path tick;tick.startNewSubPath(5,box.getY()+8);tick.lineTo(8,box.getY()+11);tick.lineTo(13,box.getY()+5);g.setColour(background);g.strokePath(tick,juce::PathStrokeType(1.7f));}
        g.setColour(text.withAlpha(alpha));g.setFont(font(13.f));g.drawText(button.getButtonText(),25,0,button.getWidth()-25,button.getHeight(),juce::Justification::centredLeft);
    }
};
}
