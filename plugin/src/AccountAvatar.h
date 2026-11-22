#pragma once
#include <juce_core/juce_core.h>
#include <memory>

namespace accountavatar {
using Bytes=std::shared_ptr<const juce::MemoryBlock>;
// Bound compressed bytes and decoded dimensions before invoking the native decoder.
inline bool validRaster(const juce::MemoryBlock& block){
 const auto* p=static_cast<const unsigned char*>(block.getData());const auto n=block.getSize();
 const auto sizeOK=[](unsigned w,unsigned h){return w>0&&h>0&&w<=512&&h<=512;};
 if(n<24||n>131072)return false;
 const unsigned char png[]={137,80,78,71,13,10,26,10};
 if(std::memcmp(p,png,8)==0&&std::memcmp(p+12,"IHDR",4)==0){auto value=[&](size_t i){return (unsigned(p[i])<<24)|(unsigned(p[i+1])<<16)|(unsigned(p[i+2])<<8)|p[i+3];};return sizeOK(value(16),value(20));}
 if(p[0]!=255||p[1]!=216)return false;
 for(size_t i=2;i+3<n;){if(p[i++]!=255)return false;while(i<n&&p[i]==255)++i;if(i>=n)return false;const auto marker=p[i++];if(marker==217||marker==218)return false;if(marker==1||(marker>=208&&marker<=215))continue;if(i+1>=n)return false;const size_t length=(size_t(p[i])<<8)|p[i+1];if(length<2||i+length>n)return false;
  if((marker>=192&&marker<=195)||(marker>=197&&marker<=199)||(marker>=201&&marker<=203)||(marker>=205&&marker<=207)){if(length<8)return false;return sizeOK((unsigned(p[i+5])<<8)|p[i+6],(unsigned(p[i+3])<<8)|p[i+4]);}i+=length;
 }return false;
}
inline Bytes load(const juce::String& source){
 const juce::URL url(source);const auto host=url.getDomain().toLowerCase();
 if(!source.startsWith("https://")||!juce::StringArray{"img.clerk.com","images.clerk.com","images.clerk.dev","clerk.sessionstream.app","avatars.githubusercontent.com","lh3.googleusercontent.com","lh4.googleusercontent.com","lh5.googleusercontent.com","lh6.googleusercontent.com"}.contains(host))return {};
 // Clerk's image proxy supports bounded raster output; external provider URLs stay intact.
 auto request=url;if(host.contains("clerk"))request=url.withParameter("width","64").withParameter("height","64").withParameter("fit","crop").withParameter("format","png");
 int status=0;auto stream=request.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress).withConnectionTimeoutMs(1500).withNumRedirectsToFollow(0).withStatusCode(&status));
 if(!stream||status!=200)return {};auto bytes=std::make_shared<juce::MemoryBlock>();stream->readIntoMemoryBlock(*bytes,131073);return validRaster(*bytes)?bytes:Bytes{};
}
}
