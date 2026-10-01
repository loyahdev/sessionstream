#include "WorkerThread.h"
#import <Foundation/Foundation.h>

void sessionstream::withAutoreleasePool(const std::function<void()>& work) {
    @autoreleasepool { work(); }
}
