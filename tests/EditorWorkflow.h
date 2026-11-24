#pragma once
#include <stdexcept>
// Isolated real native controls, with no clipboard, real account or public tunnel.
class EditorWorkflow {
public:
 int stage=0,errorWait=0;bool done=false;
 void run(StreamProcessor& p,juce::AudioProcessorEditor& editor){
  auto button=[&](const char* id){return find<juce::Button>(editor,id);};
  auto field=[&](const char* id){return find<juce::TextEditor>(editor,id);};
  auto* combo=find<juce::ComboBox>(editor,"link-kind");const auto s=p.controller->status();
  auto onSession=[&]{return button("copy-link")->isVisible();};
  if(stage>1)check(button("stream-toggle")->getBounds()==primaryBounds,"Primary control moved during an edit or session transition");
  switch(stage){
  case 0:
   if(button("account")->getButtonText()=="Restoring account..."){
    check(!button("account")->isEnabled()&&!button("stream-toggle")->isEnabled(),"Actions enabled during account restore");
    if(!sawAccountRestore)snapshot(editor,"/private/tmp/sessionstream-account-loading.png");
    sawAccountRestore=true;return;
   }
   if(!s.ready||!s.linkAuthorized||!s.planKnown||!button("ignore-update")->isVisible())return;
   if(combo->getSelectedId()!=2)return;
   check(sawAccountRestore,"Account restore had no loading state");
   check(editor.getWidth()==860&&editor.getHeight()==572,"Update layout");bounds(editor);button("ignore-update")->triggerClick();next();return;
  case 1:
   if(editor.getHeight()!=510)return;primaryBounds=button("stream-toggle")->getBounds();
   check(onSession()&&!button("copy-link")->isEnabled()&&!button("qr-code")->isEnabled(),"Initial share controls should stay in place");
   check(!button("end-session")->isEnabled(),"Empty session can be ended");check(combo->getSelectedId()==2,"Saved custom link was not selected by default");
   button("session-setup")->triggerClick();next();return;
  case 2:
   if(!find<juce::Component>(editor,"setup-panel")->isVisible())return;
   check(editor.getWidth()==860&&editor.getHeight()==510,"Settings changed window size");check(p.linkExpiryHours==0,"New sessions should not expire");
   snapshot(editor,"/private/tmp/sessionstream-stable-settings.png");find<juce::ComboBox>(editor,"stream-format")->setSelectedId(2,juce::sendNotificationSync);combo->setSelectedId(2,juce::sendNotificationSync);next();return;
  case 3:
   if(p.streamQuality!=1||s.linkMode!="custom"||s.linkBusy||!field("custom-name")->isVisible())return;
   field("custom-name")->setText("12");next();return;
  case 4:
   if(button("save-name")->isEnabled())return;field("custom-name")->setText("qa-studio");next();return;
  case 5:
   if(!button("save-name")->isEnabled())return;button("save-name")->triggerClick();next();return;
  case 6:
   if(s.customName!="qa-studio"||s.linkBusy)return;check(s.accountPhase=="signed-in"&&s.linkAuthorized,"Save lost account");field("custom-name")->setText("taken-studio");next();return;
  case 7:
   if(!button("save-name")->isEnabled())return;button("save-name")->triggerClick();next();return;
  case 8:
   if(s.linkBusy||s.linkMessage.isEmpty())return;check(s.customName=="qa-studio"&&field("custom-name")->getText()=="taken-studio","Conflict lost name or draft");field("custom-name")->setText("qa-studio");next();return;
  case 9:
   if(!button("save-name")->isEnabled())return;button("save-name")->triggerClick();next();return;
  case 10:
   if(s.linkBusy||s.linkMessage.isNotEmpty()||!button("use-passcode")->isEnabled())return;button("use-passcode")->triggerClick();next();return;
  case 11:
   if(!find<juce::ToggleButton>(editor,"use-passcode")->getToggleState()||button("stream-toggle")->isEnabled())return;
   field("session-passcode")->setText("qa-passcode");next();return;
  case 12:
   if(!button("stream-toggle")->isEnabled())return;button("stream-toggle")->triggerClick();next();return;
  case 13:
   if(!s.live||s.link.isEmpty()||!s.passcodeRequired||find<juce::ComboBox>(editor,"stream-format")->isEnabled()||combo->isEnabled()||field("session-passcode")->isEnabled())return;
   check(find<juce::Component>(editor,"setup-panel")->isVisible(),"Starting navigated away from Settings");
   check(!find<juce::ComboBox>(editor,"stream-format")->isEnabled()&&!combo->isEnabled()&&!field("session-passcode")->isEnabled(),"Session settings are not locked");
   if(!button("session-page")->isEnabled()||s.generating)return;button("session-page")->triggerClick();next();return;
  case 14:
   if(!onSession()||!button("qr-code")->isEnabled()){if(++errorWait%100==0)std::cout<<"UI_WAIT session="<<onSession()<<" qr="<<button("qr-code")->isEnabled()<<" page="<<button("session-page")->isEnabled()<<" generating="<<s.generating<<" live="<<s.live<<" link="<<s.link.isNotEmpty()<<std::endl;return;}
   check(s.streamStartedAt>0&&s.link.endsWith("/qa-studio"),"Wrong invite or missing timer");savedLink=s.link;
   check(button("stream-toggle")->getButtonText()=="Pause streaming","Unclear streaming action");button("send-mode")->triggerClick();button("qr-code")->triggerClick();next();return;
  case 15:
   if(!find<juce::Component>(editor,"qr-overlay")->isVisible())return;check(p.isSending()&&s.live,"Selected Send tab stopped the stream");snapshot(editor,"/private/tmp/sessionstream-stable-qr.png");button("qr-close")->triggerClick();next();return;
  case 16:
   if(find<juce::Component>(editor,"qr-overlay")->isVisible()||juce::Time::currentTimeMillis()-s.streamStartedAt<1600)return;
   if(!p.localMuted()){button("mute-local")->triggerClick();return;}snapshot(editor,"/private/tmp/sessionstream-stable-live.png");button("stream-toggle")->triggerClick();next();return;
  case 17:
   if(s.live||p.isSending())return;check(s.link==savedLink&&s.hasSession,"Pause replaced the invite");
   if(button("stream-toggle")->getButtonText()!="Resume streaming")return;snapshot(editor,"/private/tmp/sessionstream-stable-paused.png");button("session-setup")->triggerClick();next();return;
  case 18:
   if(!find<juce::Component>(editor,"setup-panel")->isVisible())return;check(!combo->isEnabled()&&!find<juce::ComboBox>(editor,"stream-format")->isEnabled(),"Paused settings can silently replace an invite");button("session-page")->triggerClick();next();return;
  case 19:
   if(!onSession())return;button("stream-toggle")->triggerClick();next();return;
  case 20:
   if(!s.live)return;check(s.link==savedLink,"Resume replaced invite");button("end-session")->triggerClick();next();return;
  case 21:
   if(button("end-session")->getButtonText()!="Confirm end")return;check(p.isSending()&&s.live,"First End click disconnected listeners");snapshot(editor,"/private/tmp/sessionstream-stable-confirm.png");button("end-session")->triggerClick();next();return;
  case 22:
   if(s.ending||s.hasSession||s.link.isNotEmpty()||p.isSending()||button("copy-link")->isEnabled()||button("end-session")->isEnabled()||find<juce::ToggleButton>(editor,"use-passcode")->getToggleState())return;
   check(!find<juce::ToggleButton>(editor,"use-passcode")->getToggleState(),"End left passcode enabled");
   check(s.accountPhase=="signed-in"&&s.customName=="qa-studio","End removed account or custom name");check(!p.localMuted(),"End retained monitoring mute");snapshot(editor,"/private/tmp/sessionstream-stable-ended.png");
   find<juce::Slider>(editor,"stream-gain")->setValue(-6,juce::sendNotificationSync);button("receive-mode")->triggerClick();next();return;
  case 23:
   if(!p.isReceiveMode()||!field("receive-target")->isVisible())return;check(std::abs(p.gainDb()+6)<.001&&find<juce::Slider>(editor,"stream-gain")->getMaximum()==6,"Receive gain cap");field("receive-target")->setText("invalid link");next();return;
  case 24:
   if(!button("stream-toggle")->isEnabled())return;button("stream-toggle")->triggerClick();next();return;
  case 25:
   if(s.receivePhase!="error"||++errorWait<8)return;
   check(button("stream-toggle")->getButtonText()=="Retry connection","Missing retry");check(field("receive-target")->isVisible()&&field("receive-target")->isEnabled(),"Receive invite cannot be corrected");snapshot(editor,"/private/tmp/sessionstream-stable-receive.png");button("new-link")->triggerClick();next();return;
  case 26:
   if(p.isReceiving())return;button("send-mode")->triggerClick();p.controller->account(false);next();return;
  case 27:
   if(s.accountPhase!="signed-out"||p.isReceiveMode()||!button("receive-mode")->isEnabled()||!button("stream-toggle")->isEnabled())return;
   check(button("receive-mode")->isVisible(),"Guest cannot access Receive");button("receive-mode")->triggerClick();next();return;
  case 28:
   if(!p.isReceiveMode()||!field("receive-target")->isVisible())return;
   bounds(editor);snapshot(editor,"/private/tmp/sessionstream-stable-guest.png");done=true;
   std::cout<<"PASS: native editor stable inline settings, no automatic navigation, fixed primary position, custom auth/conflicts, passcode, quality, timer, monitor mute, pause/resume invite continuity, confirmed End, Receive recovery and guest/update states"<<std::endl;return;
  }
 }
private:
 juce::String savedLink;juce::Rectangle<int> primaryBounds;bool sawAccountRestore=false;
 void next(){++stage;std::cout<<"UI_QA_STAGE "<<stage<<std::endl;}
 static void check(bool ok,const char* text){if(!ok)throw std::runtime_error(text);}
 template<class T> static T* lookup(juce::Component& root,const char* id){if(root.getComponentID()==id)if(auto* value=dynamic_cast<T*>(&root))return value;for(auto* child:root.getChildren())if(auto* value=lookup<T>(*child,id))return value;return nullptr;}
 template<class T> static T* find(juce::Component& root,const char* id){auto* value=lookup<T>(root,id);if(!value)throw std::runtime_error(std::string("Missing control ")+id);return value;}
 static void bounds(juce::Component& root){for(auto* c:root.getChildren())if(c->isVisible())check(root.getLocalBounds().contains(c->getBounds()),"Visible control outside editor");}
 static void snapshot(juce::Component& root,const char* path){auto image=root.createComponentSnapshot(root.getLocalBounds(),true,juce::jlimit(1.0f,4.0f,juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_EDITOR_SNAPSHOT_SCALE","2").getFloatValue()));juce::File file(path);auto out=file.createOutputStream();check(out!=nullptr,"Snapshot open failed");out->setPosition(0);out->truncate();juce::PNGImageFormat png;png.writeImageToStream(image,*out);out->flush();}
};
