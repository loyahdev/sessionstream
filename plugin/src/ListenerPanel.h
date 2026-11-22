#pragma once
#include "ModernButton.h"
class ListenerPanel final : public juce::Component {
public:
 std::function<void(juce::var)> onAction;
 ListenerPanel(){
  addAndMakeVisible(approval);addAndMakeVisible(accounts);addAndMakeVisible(feedback);addAndMakeVisible(view);addAndMakeVisible(reset);
  approval.setButtonText("Approve each listener");accounts.setButtonText("Require signed-in accounts");
  approval.setTooltip("Guests request access before any audio is sent. Pro required.");accounts.setTooltip("Allow verified SessionStream accounts only. Leave off to accept guests. Pro required.");
  feedback.setButtonText("Allow mix feedback");feedback.setTooltip("Let approved listeners send a timestamped reaction or mix note. Pro required.");
  approval.onClick=accounts.onClick=feedback.onClick=[this]{settings(approval.getToggleState(),accounts.getToggleState(),feedback.getToggleState());};
  reset.setButtonText("Use Free access");reset.onClick=[this]{settings(false,false,false);};view.setViewedComponent(&content,false);view.setScrollBarsShown(true,false);
 }
 void configure(const juce::var& value,bool paid,bool host,const juce::String& ack,const juce::String& error,int savedPreferences){
  pro=paid;ready=host;
  const bool approve=savedPreferences<0?bool(value["approval"]):(savedPreferences&1)!=0;
  const bool requireAccount=savedPreferences<0?bool(value["requireAccount"]):(savedPreferences&2)!=0;
  if(!pendingSettings.isEmpty()&&(ack==pendingSettings||juce::Time::getMillisecondCounter()-settingsSentAt>15000))pendingSettings.clear();
  if(pendingSettings.isEmpty()){
   studio::syncToggleState(approval,approve);
   studio::syncToggleState(accounts,requireAccount);
   studio::syncToggleState(feedback,savedPreferences<0?bool(value["feedback"]):(savedPreferences&4)!=0);
  }
  if(message!=error){message=error;repaint();}
  approval.setEnabled(pro&&ready);accounts.setEnabled(pro&&ready);feedback.setEnabled(pro&&ready);reset.setVisible(!pro&&(approve||requireAccount));reset.setEnabled(ready);
  const auto key=juce::JSON::toString(value["listeners"])+juce::JSON::toString(value["notes"])+juce::String(int(pro))+juce::String(int(ready));if(key==last)return;last=key;rows.clear();history.clear();
  if(auto* items=value["listeners"].getArray())for(const auto& item:*items){auto* row=rows.add(new Row(item,pro&&ready,[this](juce::var command){if(onAction)onAction(command);}));content.addAndMakeVisible(row);}
  if(auto* notes=value["notes"].getArray())for(int i=notes->size()-1;i>=0;--i){auto* row=history.add(new NoteRow(notes->getReference(i)));content.addAndMakeVisible(row);}
  resized();repaint();
 }
 void resized()override{
  approval.setBounds(0,0,getWidth(),24);accounts.setBounds(0,26,getWidth(),24);feedback.setBounds(0,52,getWidth(),24);reset.setBounds(0,78,getWidth(),24);view.setBounds(0,108,getWidth(),juce::jmax(0,getHeight()-108));
  const int w=juce::jmax(0,getWidth()-10);
  int y=0;
  for(int i=0;i<rows.size();++i){
   const int h=rows[i]->rowHeight();
   rows[i]->setBounds(0,y,w,h);
   y+=h+6;
  }
  if(!history.isEmpty())y+=12;
  for(auto* note:history){note->setBounds(0,y,w,68);y+=74;}
  content.setSize(w,juce::jmax(view.getHeight(),y));
 }
 void paint(juce::Graphics& g)override{g.setFont(studio::font(10));g.setColour(studio::muted);g.drawFittedText(!ready?"This session belongs to another track.":!pro?"Pro unlocks listener access controls.":message.isNotEmpty()?message:rows.isEmpty()?"No listeners or requests yet.":"Manage room access and mix notes.",0,80,getWidth(),24,juce::Justification::topLeft,2);}
private:
 struct NoteRow final:juce::Component{
  juce::String title,text;
  explicit NoteRow(const juce::var& item){const int sec=juce::jmax(0,int(item["offsetSeconds"]));title=item["name"].toString()+"  "+juce::String(sec/60).paddedLeft('0',2)+":"+juce::String(sec%60).paddedLeft('0',2);text=item["text"].toString();setTooltipText();}
  void setTooltipText(){setName(title+" "+text);}
  void paint(juce::Graphics& g)override{g.setColour(studio::line);g.drawHorizontalLine(0,0.f,float(getWidth()));g.setColour(studio::accent);g.setFont(studio::font(9.5f,true));g.drawFittedText(title,4,6,getWidth()-8,14,juce::Justification::left,1);g.setColour(studio::text);g.setFont(studio::font(10.f));g.drawFittedText(text,4,23,getWidth()-8,40,juce::Justification::topLeft,3);}
 };
 struct Row final:juce::Component{
  juce::Label name,detail,noteLabel;studio::ModernButton accept,deny;juce::String id;bool pending,hasNote=false,online=false;
  static juce::String formatTimestamp(int sec){
   return juce::String(sec/60).paddedLeft('0',2)+":"+juce::String(sec%60).paddedLeft('0',2);
  }
  Row(const juce::var& item,bool enabled,std::function<void(juce::var)> send):id(item["id"].toString()),pending(item["status"].toString()=="pending"),online(bool(item["online"])){
   addAndMakeVisible(name);addAndMakeVisible(detail);addAndMakeVisible(deny);
   name.setText(item["name"].toString(),juce::dontSendNotification);name.setFont(studio::font(11.f,true));name.setColour(juce::Label::textColourId,studio::text);name.setTooltip(item["name"].toString());
   detail.setText((pending?juce::String("Waiting for approval"):online?juce::String("Listening"):juce::String::fromUTF8("Approved \xC2\xB7 offline"))+juce::String::fromUTF8(bool(item["verified"])?" \xC2\xB7 Verified":" \xC2\xB7 Guest"),juce::dontSendNotification);detail.setFont(studio::font(9.5f));detail.setColour(juce::Label::textColourId,studio::muted);
   deny.setButtonText(pending?"Reject":"Revoke");deny.setEnabled(enabled);deny.onClick=[this,send]{auto* c=new juce::DynamicObject();c->setProperty("id",id);c->setProperty("action",pending?"reject":"revoke");send(juce::var(c));};
   if(pending){addAndMakeVisible(accept);accept.setButtonText("Accept");accept.getProperties().set("role","primary");accept.setColour(juce::TextButton::buttonColourId,studio::accent);accept.setEnabled(enabled);accept.onClick=[this,send]{auto* c=new juce::DynamicObject();c->setProperty("id",id);c->setProperty("action","accept");send(juce::var(c));};}
  }
  int rowHeight()const{return hasNote?78:60;}
  void paint(juce::Graphics& g)override{
   auto box=getLocalBounds().toFloat().reduced(.5f);
   g.setColour(studio::inset);g.fillRoundedRectangle(box,5.f);
   g.setColour(pending?studio::accent.withAlpha(.45f):studio::line);g.drawRoundedRectangle(box,5.f,1.f);
   g.setColour(pending?studio::warm:online?studio::accent:studio::muted.withAlpha(.5f));
   g.fillEllipse(8.f,10.f,5.f,5.f);
  }
  void resized()override{
   const int pad=16,w=juce::jmax(0,getWidth()-pad-6);
   name.setBounds(pad,4,w,16);detail.setBounds(pad,19,w,13);
   if(hasNote)noteLabel.setBounds(pad,33,w,14);
   const int btnY=hasNote?50:34;
   accept.setBounds(8,btnY,76,22);deny.setBounds(pending?90:8,btnY,pending?76:84,22);
   accept.refreshStyle();deny.refreshStyle();
  }
 };
 void settings(bool a,bool b,bool c){
  if(!onAction)return;
  pendingSettings=juce::Uuid().toString();
  settingsSentAt=juce::Time::getMillisecondCounter();
  auto* command=new juce::DynamicObject();
  command->setProperty("action","settings");
  command->setProperty("requestId",pendingSettings);
  command->setProperty("approval",a);
  command->setProperty("requireAccount",b);
  command->setProperty("feedback",c);
  onAction(juce::var(command));
 }
 juce::ToggleButton approval,accounts,feedback;studio::ModernButton reset;juce::Viewport view;juce::Component content;juce::OwnedArray<Row> rows;juce::OwnedArray<NoteRow> history;juce::String last,pendingSettings,message;uint32_t settingsSentAt=0;bool pro=false,ready=false;
};
