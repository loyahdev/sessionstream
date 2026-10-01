#pragma once
#include <juce_core/juce_core.h>
#include <atomic>
#include <thread>

namespace sessionstream {
void withAutoreleasePool(const std::function<void()>& work);
}

// Join the native thread, including macOS autorelease cleanup, before the
// processor can be deleted or its plugin module unloaded. JUCE's detached
// Thread reports stopped before its outer macOS pool finishes draining.
class WorkerThread {
public:
    explicit WorkerThread(juce::String name) : threadName(std::move(name)) {}
    virtual ~WorkerThread() { stopThread(); }
protected:
    void startThread() {
        worker=std::thread([this] {
            juce::Thread::setCurrentThreadName(threadName);
            sessionstream::withAutoreleasePool([this] { run(); });
        });
    }
    void stopThread() {
        exiting=true;notify();
        if(worker.joinable())worker.join();
    }
    bool threadShouldExit() const { return exiting.load(); }
    void notify() { event.signal(); }
    void wait(int milliseconds) { event.wait(milliseconds); }
    virtual void run()=0;
private:
    juce::String threadName;
    std::atomic<bool> exiting{false};
    juce::WaitableEvent event;
    std::thread worker;
};
