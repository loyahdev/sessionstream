#include "WorkerThread.h"

void sessionstream::withAutoreleasePool(const std::function<void()>& work) {
    work();
}
