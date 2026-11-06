#include <algorithm>
#include "../plugin/src/SignalCapture.h"
#include <cassert>
#include <limits>
#include <thread>
#include <iostream>
int main(){SignalCapture q;float l[]{1,2,std::numeric_limits<float>::infinity()},r[]{-1,-2,3};q.push(l,r,3,1,0);int n=0;q.drain([&](auto){++n;});assert(n==0);q.active=true;q.push(l,r,3,.5f,.25f);q.drain([&](auto f){if(n==0)assert(f.left==.5f&&f.right==-.5f);if(n==1)assert(f.left==1.5f);if(n==2)assert(f.left==0&&f.right==3);++n;});assert(n==3);std::atomic<bool> done{false};std::thread t([&]{for(int i=0;i<100000;++i)q.push(l,r,3,1,0);done=true;});while(!done)q.drain([](auto f){assert(std::isfinite(f.left)&&std::isfinite(f.right));});t.join();q.drain([](auto){});std::cout<<"PASS bounded capture, gain, finite samples, concurrent drain\n";}
