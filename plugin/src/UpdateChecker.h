#pragma once
#include <juce_core/juce_core.h>
#include <atomic>
#include <optional>
#include <vector>
#include "WorkerThread.h"

class UpdateChecker final : private WorkerThread {
public:
    static constexpr const char* currentVersion = "0.20";
    static constexpr const char* versionURL = "https://raw.githubusercontent.com/loyahdev/sessionstream/refs/heads/main/version.txt";
    static constexpr const char* releasesURL = "https://github.com/loyahdev/sessionstream/releases/latest";
    struct Status { juce::String latest; bool checked=false, available=false; };
    using Fetch = std::function<juce::String()>;
    explicit UpdateChecker(Fetch reader=fetchVersion) : WorkerThread("SessionStream update check"), fetch(reader?std::move(reader):Fetch(fetchVersion)) { startThread(); }
    ~UpdateChecker() override { stopThread(); }
    void check() { requested=true; notify(); }
    void ignoreForSession() { ignored.store(true); }
    Status status() { const juce::ScopedLock l(lock);auto result=current;result.available=result.available&&!ignored.load();return result; }
    // Compare dotted version components as integers; trailing zeros are equal.
    static std::optional<std::vector<int>> parse(juce::String text) {
        text=text.trim();if(text.startsWithChar('v'))text=text.substring(1);
        if(text.isEmpty()||text.length()>64||text.containsAnyOf(" \t\r\n"))return {};
        const auto parts=juce::StringArray::fromTokens(text,".","");
        if(parts.size()<2||parts.size()>4)return {};
        std::vector<int> result;
        for(const auto& part:parts){if(part.isEmpty()||part.length()>8||!part.containsOnly("0123456789"))return {};result.push_back(part.getIntValue());}
        while(result.size()<4)result.push_back(0);return result;
    }
    static bool newer(const juce::String& remote,const juce::String& local=currentVersion) {
        const auto a=parse(remote),b=parse(local);return a&&b&&*a>*b;
    }
private:
    inline static std::atomic<bool> ignored{false};
    std::atomic<bool> requested{true};juce::CriticalSection lock;Status current;Fetch fetch;
    static juce::String fetchVersion() {
        int code=0;
        // Defeat the raw-file CDN's five-minute cache without sending any user data.
        const auto url=juce::URL(versionURL).withParameter("check",juce::String(juce::Time::currentTimeMillis()));
        auto stream=url.createInputStream(juce::URL::InputStreamOptions(juce::URL::ParameterHandling::inAddress)
            .withConnectionTimeoutMs(2500).withNumRedirectsToFollow(2).withStatusCode(&code)
            .withExtraHeaders("Cache-Control: no-cache\r\n"));
        if(!stream||code!=200)return {};
        char bytes[129]{};const auto count=stream->read(bytes,128);
        if(count<=0||count>64)return {};return juce::String::fromUTF8(bytes,count).trim();
    }
    void run() override {
        while(!threadShouldExit()){
            if(requested.exchange(false)){
                juce::String latest;try{sessionstream::withAutoreleasePool([&]{latest=fetch();});}catch(...){}
                Status next;next.checked=true;if(parse(latest)){next.latest=latest;next.available=newer(latest);}
                {const juce::ScopedLock l(lock);current=next;}
            }
            wait(250);
        }
    }
};
