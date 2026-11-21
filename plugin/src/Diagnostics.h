#pragma once
#include <juce_core/juce_core.h>

namespace sessionstream {
inline juce::File diagnosticDirectory(){
    const auto override=juce::SystemStats::getEnvironmentVariable("SESSIONSTREAM_STATE_DIR",{});
    if(override.isNotEmpty())return juce::File(override);
    const auto home=juce::File::getSpecialLocation(juce::File::userHomeDirectory);
#if JUCE_WINDOWS
    const auto local=juce::SystemStats::getEnvironmentVariable("LOCALAPPDATA",{});
    return (local.isNotEmpty()?juce::File(local):home.getChildFile("AppData/Local")).getChildFile("SessionStream/Cache");
#elif JUCE_MAC
    return home.getChildFile("Library/Caches/SessionStream");
#else
    const auto cache=juce::SystemStats::getEnvironmentVariable("XDG_CACHE_HOME",{});
    return (cache.isNotEmpty()?juce::File(cache):home.getChildFile(".cache")).getChildFile("SessionStream");
#endif
}
inline juce::var runtimeLogs(const juce::File& directory=diagnosticDirectory()){
    juce::Array<juce::var> logs;
    // Read retained logs directly, including after the engine has exited.
    // Runtime writers redact credentials before anything reaches these files.
    for(const auto* base:{"launcher.log","engine.log"})for(int generation=2;generation>=0;--generation){
        const auto name=juce::String(base)+(generation?"."+juce::String(generation):juce::String{});
        const auto file=directory.getChildFile(name);
        if(!file.existsAsFile())continue;
        auto* entry=new juce::DynamicObject;entry->setProperty("name",name);
        if(auto input=file.createInputStream()){
            juce::MemoryBlock bytes;input->readIntoMemoryBlock(bytes,256*1024);
            entry->setProperty("text",juce::String::fromUTF8(static_cast<const char*>(bytes.getData()),int(bytes.getSize())));
        }else entry->setProperty("error","Log could not be read");
        logs.add(juce::var(entry));
    }
    return logs;
}
}
