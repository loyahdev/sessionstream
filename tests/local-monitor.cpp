#include "Processor.h"
#include <iostream>
#include <stdexcept>
static void check(bool value,const char* message){if(!value)throw std::runtime_error(message);}
int main(int argc,char** argv){juce::ScopedJuceInitialiser_GUI gui;
 if(argc>2){
  try{
   StreamProcessor p([]{return juce::String{};},juce::String(argv[2]).getIntValue());
   p.controller=std::make_unique<StreamController>(p.transport.getSourceId(),[&]{return p.isSending();},argv[1],juce::File{},[]{return true;},[&]{p.setSending(false);});
   p.linkExpiryHours=1;p.prepareToPlay(48000,256);p.setLocalMuted(true);p.setSending(true);bool live=false;int restored=0;juce::AudioBuffer<float> b(2,256);juce::MidiBuffer midi;
   for(int tick=0;tick<1000;++tick){for(int ch=0;ch<2;++ch)for(int i=0;i<256;++i)b.setSample(ch,i,.2f);p.processBlock(b,midi);const auto s=p.controller->status();
    if(s.live&&!live){live=true;std::cout<<"EXPIRY_TEST_LIVE"<<std::endl;}
    if(live&&s.inviteExpired&&!p.isSending()&&++restored>4){check(b.getMagnitude(0,256)>.19f,"Expiry left local monitoring muted");std::cout<<"PASS: expiry stops Send and restores local output without an editor"<<std::endl;return 0;}
    juce::Thread::sleep(10);
   }
   throw std::runtime_error("Expiry controller timeout");
  }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
 }

 try{
  juce::DatagramSocket sink(false);check(sink.bindToPort(0,"127.0.0.1"),"Cannot bind isolated UDP receiver");
  StreamProcessor p([]{return juce::String{};},sink.getBoundPort());
  p.controller=std::make_unique<StreamController>(p.transport.getSourceId(),[]{return false;},"http://127.0.0.1:1");
  p.prepareToPlay(48000,256);p.setSending(true);p.setLocalMuted(true);juce::AudioBuffer<float> b(2,256);juce::MidiBuffer midi;
  for(int block=0;block<6;++block){for(int ch=0;ch<2;++ch)for(int i=0;i<256;++i)b.setSample(ch,i,ch?.1f:.2f);p.processBlock(b,midi);}
  check(b.getMagnitude(0,256)<.00001f,"Local output was not muted");
  check(sink.waitUntilReady(true,1500)>0,"Muted local monitor stopped the stream");std::array<char,4096> bytes{};check(sink.read(bytes.data(),int(bytes.size()),false)>32,"Missing stream audio");float sample=0;std::memcpy(&sample,bytes.data()+24,4);check(std::abs(sample-.2f)<.001f,"Local mute changed listener samples");
  p.setSending(false);for(int block=0;block<4;++block){b.clear();for(int ch=0;ch<2;++ch)for(int i=0;i<256;++i)b.setSample(ch,i,.2f);p.processBlock(b,midi);}check(std::abs(b.getSample(0,200)-.2f)<.001f,"Stop left DAW output muted");
  p.streamQuality=2;p.linkExpiryHours=168;juce::MemoryBlock state;p.getStateInformation(state);check(state.getSize()==17,"Session settings state missing");p.streamQuality=0;p.linkExpiryHours=24;p.setStateInformation(state.getData(),int(state.getSize()));check(p.streamQuality==2&&p.linkExpiryHours==0,"Session settings did not restore");
  p.setSending(true);p.setNonRealtime(true);b.clear();b.setSample(0,0,.25f);p.processBlock(b,midi);check(b.getSample(0,0)==.25f,"Local monitoring mute changed offline render");p.setNonRealtime(false);p.setSending(false);
  juce::MemoryBlock legacy;juce::MemoryOutputStream old(legacy,false);old.writeFloat(-3);old.writeInt(0x53535231);old.writeBool(false);old.flush();p.setStateInformation(legacy.getData(),int(legacy.getSize()));check(std::abs(p.gainDb()+3)<.001f,"Legacy project state did not restore");
  std::cout<<"PASS: local mute leaves listener PCM unchanged, smooth monitoring returns on Stop, offline renders are unchanged, new and legacy project settings restore\n";
 }catch(const std::exception& e){std::cerr<<e.what()<<"\n";return 1;}
}
