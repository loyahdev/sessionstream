# Audio safety and recovery

Listener gain is bounded to +6 dB. Browser Live and Buffered audio share a final,
non-bypassable output worklet after volume and mute, with a -1 dBFS sample-peak
ceiling, stereo-linked gain, 5 ms lookahead and 100 ms release. Normal audio below
the ceiling is unchanged except for the lookahead delay. The native sender also
limits before conversion to 16-bit Opus input, avoiding hard clipping of host
float PCM. Native plugin Receive output uses linked peak protection after gain
and caps receive boost at +6 dB, without adding lookahead latency to the DAW.
These protections do not set headphone sound pressure or guarantee a perceived
loudness limit; this is not an oversampled true-peak or LUFS processor.

Live connection establishment now allows a 15-second attempt followed by one
fresh negotiation and another 15 seconds before switching to Buffered. Waiting
for host audio does not trigger a failed-connection fallback. Explicit connection
failure also gets one retry. This cannot make an impossible direct route work:
networks requiring relaying still need the existing TURN configuration described
in DEVELOPMENT.md. No external relay account is provisioned by this change.

The engine retains 64 connection events and writes connection/ICE states, candidate
kinds, negotiation failures and Buffered selections to its rotating logs. Studio
and plugin diagnostic exports include relay configuration and this timeline;
addresses, SDP and relay credentials are not included. Browser diagnostics also
include buffer target, underrun and trim counters and safety settings.

Buffered audio starts with a 90 ms reservoir and increases it by 20 ms after
starvation, bounded by 300 ms and FIFO capacity at the source sample rate. This
trades latency for fewer repeat underruns. Playback fades out/in around starvation.
Loss concealment estimates missing frame counts from the preceding packet rather
than assuming all packets contain 256 frames.

Verification must distinguish automated DSP and local browser transport tests
from a real cross-network session. Luis's original failure cannot be reproduced
from his export; test a future remote session using the new connection timeline.
