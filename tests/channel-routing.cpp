#include "Processor.h"
#include <iostream>
#include <memory>
int main(){juce::ScopedJuceInitialiser_GUI init;
 for(int channels:{1,2,6,8}){
  auto processor=std::make_unique<StreamProcessor>();processor->controller.reset();auto layout=processor->getBusesLayout();auto set=juce::AudioChannelSet::canonicalChannelSet(channels);layout.inputBuses.set(0,set);layout.outputBuses.set(0,set);if(!processor->setBusesLayout(layout))return 1;processor->streamQuality=8;processor->streamChannels=channels;
  juce::MemoryBlock state;processor->getStateInformation(state);auto restored=std::make_unique<StreamProcessor>();restored->controller.reset();restored->setStateInformation(state.getData(),int(state.getSize()));if(restored->streamChannels!=channels||restored->streamQuality!=8)return 2;
  juce::DatagramSocket socket(false);if(!socket.bindToPort(0,"127.0.0.1"))return 3;auto sender=std::make_unique<StreamTransport>(socket.getBoundPort());sender->enabled=true;auto receiver=std::make_unique<ReceiveTransport>();receiver->enabled=true;
  juce::AudioBuffer<float> input(channels,256),output(channels,256);for(int ch=0;ch<channels;ch++)for(int i=0;i<256;i++)input.setSample(ch,i,float(ch+1)*.03f);
  juce::DatagramSocket forward(false);std::array<unsigned char,24+256*8*4> packet{};
  for(int n=0;n<16;n++){sender->push(input.getArrayOfReadPointers(),channels,channels,256,48000);if(socket.waitUntilReady(true,1000)<=0)return 4;const auto bytes=socket.read(packet.data(),int(packet.size()),false);if(bytes!=24+256*channels*4||packet[14]!=channels)return 5;for(int i=0;i<256;i++)for(int ch=0;ch<channels;ch++){float value;std::memcpy(&value,packet.data()+24+(i*channels+ch)*4,4);if(std::abs(value-float(ch+1)*.03f)>.000001f)return 6;}forward.write("127.0.0.1",receiver->port(),packet.data(),bytes);juce::Thread::sleep(2);}
  juce::Thread::sleep(30);receiver->render(output.getArrayOfWritePointers(),channels,256,48000,1.f,0.f);for(int ch=0;ch<channels;ch++)for(int i=0;i<256;i++)if(std::abs(output.getSample(ch,i)-float(ch+1)*.03f)>.000001f)return 7;
  std::cout<<"PASS: "<<channels<<" channel native bus, persisted state, UDP sender and DAW receiver preserve every channel"<<std::endl;
 }
}
