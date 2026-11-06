#include "ReceiveTransport.h"
#include <iostream>
#include <memory>
#include <vector>
#include <thread>
static void put32(unsigned char* p,uint32_t n){for(int i=0;i<4;++i)p[i]=static_cast<unsigned char>(n>>(i*8));}
int main(){
    for(double outputRate:{44100.,48000.,96000.}){
        auto receiver=std::make_unique<ReceiveTransport>();receiver->enabled=true;juce::DatagramSocket socket(false);
        for(int packet=0;packet<24;++packet){
            std::array<unsigned char,2072> bytes{};std::memcpy(bytes.data(),"STRM",4);put32(bytes.data()+4,packet);put32(bytes.data()+8,96000);bytes[13]=1;bytes[14]=2;put32(bytes.data()+20,1);
            for(int i=0;i<256;++i){float l=.4f*std::sin(2*3.141592653589793*440*(packet*256+i)/96000.),r=l*.5f;std::memcpy(bytes.data()+24+i*8,&l,4);std::memcpy(bytes.data()+28+i*8,&r,4);}
            if(socket.write("127.0.0.1",receiver->port(),bytes.data(),static_cast<int>(bytes.size()))!=static_cast<int>(bytes.size()))return 1;
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(30));std::vector<float> left(1024),right(1024);
        receiver->render(left.data(),right.data(),1024,outputRate,1.f,0.f);
        for(int i=0;i<1024;++i){const auto expected=.4*std::sin(2*3.141592653589793*440*i/outputRate);if(std::abs(left[i]-expected)>.002||std::abs(right[i]-expected*.5)>.002){std::cerr<<"Audio mismatch at "<<outputRate<<" frame "<<i<<std::endl;return 2;}}
        receiver->enabled=false;receiver->render(left.data(),right.data(),1024,outputRate,1.f,0.f);
        for(int i=0;i<1024;++i)if(left[i]!=0||right[i]!=0)return 3;
    }
    {
        auto receiver=std::make_unique<ReceiveTransport>();receiver->enabled=true;juce::DatagramSocket socket(false);
        for(int packet=0;packet<24;++packet){
            std::array<unsigned char,2072> bytes{};std::memcpy(bytes.data(),"STRM",4);put32(bytes.data()+4,packet);put32(bytes.data()+8,48000);bytes[13]=1;bytes[14]=2;put32(bytes.data()+20,1);
            for(int i=0;i<256;++i){float l=20.f,r=5.f;std::memcpy(bytes.data()+24+i*8,&l,4);std::memcpy(bytes.data()+28+i*8,&r,4);}
            socket.write("127.0.0.1",receiver->port(),bytes.data(),static_cast<int>(bytes.size()));
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(30));std::vector<float> left(1024),right(1024);
        receiver->render(left.data(),right.data(),1024,48000,4.f,0.f);
        for(int i=0;i<1024;++i)if(!std::isfinite(left[i])||std::abs(left[i])>.891252f||std::abs(right[i]-left[i]*.25f)>.00001f)return 4;
        if(left[0]<.8f)return 5;
    }
    std::cout<<"PASS: stereo receive PCM, 96 kHz to 44.1/48/96 kHz conversion, silence on disconnect, and post-gain stereo peak safety"<<std::endl;
}
