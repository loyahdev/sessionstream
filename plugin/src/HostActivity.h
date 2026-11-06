#pragma once
#include <juce_core/juce_core.h>
#include <atomic>

// Audio preparation and device bypass have different lifetimes. Hosts release
// and reprepare audio around renders; only bypass/removal revokes the session.
class HostActivity {
public:
    void prepare() noexcept { block(false); }
    void block(bool bypassed) noexcept {
        blocked.store(bypassed, std::memory_order_relaxed);
        prepared.store(true, std::memory_order_release);
    }
    void deactivate() noexcept { prepared.store(false, std::memory_order_release); }
    bool enabled() const noexcept {
        return prepared.load(std::memory_order_acquire)&&!blocked.load(std::memory_order_relaxed);
    }
    bool sessionEnabled() const noexcept { return !blocked.load(std::memory_order_relaxed); }
private:
    std::atomic<bool> prepared{false}, blocked{false};
};
