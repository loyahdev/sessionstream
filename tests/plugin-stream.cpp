#include "Processor.h"
#include <chrono>
#include <thread>
#include <iostream>
int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;
    StreamProcessor p; p.prepareToPlay(48000, 256); p.setSending(true);
    juce::AudioBuffer<float> b(2, 256); juce::MidiBuffer midi;
    const int seconds = argc > 1 ? std::atoi(argv[1]) : 30;
    const auto start = std::chrono::steady_clock::now(); uint64_t sample = 0;
    for (int block=0; block<seconds*48000/256; ++block) {
        for(int i=0;i<256;i++,sample++) {
            b.setSample(0,i,.08f*std::sin(2*juce::MathConstants<double>::pi*440*sample/48000));
            b.setSample(1,i,.04f*std::sin(2*juce::MathConstants<double>::pi*880*sample/48000));
        }
        p.processBlock(b,midi);
        std::this_thread::sleep_until(start+std::chrono::microseconds(sample*1000000/48000));
    }
    std::cout << "Native processor streamed " << p.transport.sent.load() << " stereo packets; dropped " << p.transport.dropped.load() << "\n";
}
