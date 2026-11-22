# SessionStream 1.0.3 audio formats

The former Studio, Balanced and Phone names are removed from the native UI and current website. Internal legacy quality IDs remain readable for old DAW projects and controller clients.

- Free sender: Opus, 320 kbps, stereo. The existing listener-side buffered PCM fallback remains available.
- Pro sender: Opus 96, 128, 192, 256, 320 or 510 kbps, mono or stereo at 48 kHz.
- Pro PCM: signed 16-bit, signed 24-bit or 32-bit float at the DAW sample rate: 44.1, 48, 88.2, 96, 176.4 or 192 kHz. Mono, stereo, 5.1 and 7.1.
- PCM bit depth is a transport setting. Integer PCM clamps to full scale; 32-bit float preserves finite samples. Monitoring gain and the existing final peak safety still apply at playback.
- 5.1 and 7.1 require a matching DAW bus and PCM. The plugin exposes actual JUCE/VST3/AU channel layouts. Stereo sources cannot select invented surround channels.
- Channel order: L R C LFE Ls Rs, then Lrs Rrs for 7.1. The native receiver preserves matching layouts. Stereo audition includes centre and surrounds at -3 dB, excluding LFE. Mono audition averages that stereo mix.
- Browser output uses the full layout when the AudioContext destination reports enough channels. Otherwise the listener explicitly shows stereo monitoring. Physical interface/driver speaker mapping needs real hardware verification.
- Direct and Cloud use the same PCM packet format. Cloud uploads PCM without Opus conversion. Encryption and key rotation are unchanged and support all payload layouts.
- Settings are locked for an existing invite. End the session to change codec, bitrate, depth or channels. Restoring an old 17-byte project state defaults to stereo; new state also stores the channel layout.
- Engine control protocol 8 prevents an older helper from pretending to support the new formats. An active old session must be stopped before replacing its helper.
- AAC is not included in this release. It needs its own encoder/decoder implementation and packaging.

Raw PCM payload bandwidth, before protocol overhead: rate × channels × bit depth. At 48 kHz / 24-bit, stereo is 2.304 Mbps, 5.1 is 6.912 Mbps and 7.1 is 9.216 Mbps. Listener-hour accounting does not change.
