#pragma once
#include <juce_core/juce_core.h>
#include <atomic>

// Host activation/bypass is authoritative. A host may stop rendering an
// enabled silent track, so absence of audio callbacks cannot mean power off.
class HostActivity {
public:
    void prepare() noexcept { block(false, false); }
    void block(bool bypassed, bool offline) noexcept {
        blocked.store(bypassed || offline, std::memory_order_relaxed);
        prepared.store(true, std::memory_order_release);
    }
    void deactivate() noexcept { prepared.store(false, std::memory_order_release); }
    bool enabled() const noexcept {
        return prepared.load(std::memory_order_acquire)&&!blocked.load(std::memory_order_relaxed);
    }
private:
    std::atomic<bool> prepared{false}, blocked{false};
};
