#pragma once
#include <juce_core/juce_core.h>
namespace streamformat {
inline constexpr const char* ids[]={"studio","balanced","phone","opus128","opus192","opus256","pcm16","pcm24","pcm32"};
inline constexpr const char* names[]={"Opus / 510 kbps","Opus / 320 kbps","Opus / 96 kbps","Opus / 128 kbps","Opus / 192 kbps","Opus / 256 kbps","PCM / 16-bit","PCM / 24-bit","PCM / 32-bit float"};
inline bool pcm(int index){return index>=6&&index<=8;}
inline juce::String layout(int channels){return channels==1?"Mono":channels==6?"5.1":channels==8?"7.1":"Stereo";}
inline bool validChannels(int channels){return channels==1||channels==2||channels==6||channels==8;}
}
