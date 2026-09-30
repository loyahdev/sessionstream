# Verification recorded September 30, 2026 (America/Edmonton)

SessionStream 0.10 was built, ad-hoc signed and installed on this Apple Silicon Mac. The source and bundled listener include the low-delay duplicate-playback fix and simplified listener layout with 100% initial volume.

- The hidden WebRTC decoder element is explicitly muted, including its DOM attribute and default muted state. Its volume is also zero. Audible output is through the listener's Web Audio gain alone.
- PCM output is disconnected during WebRTC mode, and reconnected for compatibility mode. Late track events from replaced peer connections are ignored.
- Eleven Node tests passed, including native FIFO simulations for 60 seconds of 2048-frame DAW bursts at 44.1, 48, 96 and 192 kHz, private controls, source isolation and invite persistence across stop/start.
- The compiled VST3's native test host verified unchanged passthrough, outgoing gain, safe state restore and a complete 8192-frame UDP burst.
- Baseline, before the phone playback/waveform follow-up: fifteen browser integration checks passed in Chrome 154.0.8037.58 with the actual VST3, bundled native sender and a public Cloudflare Quick Tunnel. WebRTC media used a same-Mac direct path; compatibility PCM traveled through the public tunnel.
- Rendered WebRTC and PCM audio retained distinct L/R channels. The plugin's -6 dB control halved listener amplitude.
- The hidden decoder stayed muted even when its element volume was forced to full, simulating devices that ignore volume-zero assignments. Listener volume zero silenced the Web Audio output. Repeated PCM/WebRTC switches left one explicitly muted decoder in WebRTC mode and none in PCM mode.
- The listener starts with both its slider and actual Web Audio output gain at 100%. The centered listening page has the requested description, top bar and built by loyahdev footer; the marketing labels are removed; waveform and visible audio metrics were restored in the follow-up. Desktop and phone screenshots were inspected.
- Listener reconnect, stop/start and mobile-width layout checks passed, with no page errors. Native sender underruns and trims were zero during the continuous playback portion of the test.
- The plugin was installed at ~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3, preserving the previous installed bundle. The current test tunnel is running with streaming off.

Detailed evidence: `artifacts/browser-report.json` and `artifacts/browser-0.10-installed.log`.

Update and installer verification:

- The native update-check executable fetched the real version URL successfully: installed display version 0.10, remote 0.10, no update notice. Numeric comparison, future/patch releases, malformed replies, background fetching and dismissal across instances passed (`artifacts/update-check-0.10.log`).
- A native editor test used an injected 0.11 response. The Get update / Ignore for this session banner was visually inspected; clicking Ignore removed it. This simulation did not change the public version file.
- The generated PKG was expanded and its embedded VST3 passed deep strict code-signature verification. Bundle metadata is 0.10.0. The payload contains the plugin, Node, cloudflared, native WebRTC addon, listener files and dependency notices, with no separately installed app.
- macOS Installer successfully installed the actual PKG into the CurrentUserHomeDirectory domain at ~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3. The installed VST3 passed deep strict signature verification.
- Before the phone playback/waveform follow-up, all fifteen browser checks were rerun with PLUGIN_PATH pointing to that PKG-installed VST3. Starting from a stopped engine, the plugin started its bundled helper and anonymous Cloudflare Quick Tunnel without a sender browser or login. WebRTC stereo, PCM fallback, gain, reconnect, stop/start, exclusive output and volume defaults passed. Continuous playback recorded zero native underruns and trims.
- The current release endpoint has no published GitHub release. Get update opens the releases/latest page; the next installer must be published there before raising version.txt.
- Mach-O inspection found Node requires macOS 13.5; installer minimum was raised to 13.5 accordingly. Bundled runtime binaries link only system libraries, with no Homebrew dependency.
- Package scope: Apple Silicon, macOS 13.5+. Plugin/runtime binaries are ad-hoc signed; the PKG is unsigned and is not notarized. No Developer ID signing identity is configured.

Phone playback and waveform follow-up:

- Listening now requests navigator.audioSession.type = playback before creating the audio context and again when resuming. Closing the context restores the previous type. This uses WebKit's documented iOS 17+ approach to avoid the silent switch muting Web Audio (https://bugs.webkit.org/show_bug.cgi?id=237322). Unsupported/rejected API calls do not prevent listening.
- Restored a live waveform, stereo codec/source rate, connection, RTT, buffer and packet loss/reset metrics. Desktop and 390px phone screenshots were inspected. Resume also clears stale paused-status text and handles interrupted contexts.
- Isolated native-sender browser checks passed with supported, absent and rejecting simulated AudioSession APIs. Each profile rendered stereo through WebRTC and PCM, preserved the single muted decoder/one audible output, obeyed listener volume zero, displayed the waveform/details and had no page errors. Supported-API checks verified playback mode before context creation, on resume and prior-category restoration on stop.
- Evidence: artifacts/browser-playback-session.json, artifacts/browser-playback-session.log, artifacts/listener-phone-waveform.png and artifacts/listener-waveform-desktop.png. The test uses synthetic tones on separate ports, leaving the user's broadcast/invite intact. It is Chrome with a simulated AudioSession API, not physical-iPhone verification.
- Updated listener files are bundled into the plugin, installed with a preserved backup and included in the rebuilt PKG. The active public site was checked for the new playback category and waveform/details.

Cold startup and first-link follow-up:

- Opening the editor now prepares the engine and anonymous tunnel. Generate remains pending until the listener site is verified; the editor disables repeated generation and displays startup progress. No plugin/editor reload is needed.
- Managed helpers keep readiness in memory and ignore a predecessor's cached URL. Health responses identify the current engine, two direct probes must succeed, and a further normal-DNS HTTPS check must reach the same engine before the invite becomes available. Exited/replaced tunnels cannot publish a late probe result.
- Early queries to local DNS were returning cached NXDOMAIN while public DNS already had the tunnel's A records. Fresh-host probes now use public DNS before consulting the system resolver, with an HTTPS DNS fallback for networks blocking external UDP DNS. The actual HTTPS fallback returned the current tunnel's addresses when UDP lookup was deliberately rejected.
- Generate uses a request ID so retries cannot accidentally rotate an already-created room. Native-controller regressions passed delayed readiness, a lost POST acknowledgement, a failed subsequent status read, and helper replacement after acknowledgement. Temporary API failures do not immediately launch a duplicate helper.
- Eighteen Node tests passed. The native cold-start probe launched the final bundled engine and tunnel itself, kept its first Generate click pending, and delivered a working public invite in 16.46 seconds. Chrome loaded that first link and joined its private room. Subsequent Generate took 0.103 seconds. The probe exited normally. These are individual measurements, not startup-time guarantees.
- All fifteen browser checks passed again against the installed final VST3, starting with the default engine stopped. The plugin started its bundled helper with no broadcaster page or Cloudflare login. Public signaling, stereo WebRTC, public-tunnel compatibility PCM, gain, exclusive output, 100% volume, reconnect, stop/start and mobile layout passed; the continuous-audio portion recorded zero underruns and trims.
- Final bundles were ad-hoc signed and installed with a backup. The rebuilt PKG was expanded; its VST3 passed deep strict signature verification and its native binary, companion and readiness module matched the final built/source files. The latest PKG was inspected but not installed through macOS Installer again; the installed plugin came from the matching signed bundle using the backup-preserving install script.
- Evidence: artifacts/controller-cold-start-public.log, artifacts/controller-retry.log, artifacts/controller-restart.log, artifacts/tests-cold-start.log, artifacts/browser-cold-start.log, artifacts/browser-report.json and artifacts/install-cold-start.log.

DAW compatibility and two-format installer follow-up:

- Installer welcome/conclusion now describe VST3 and Audio Units (AU), with Ableton Live, Logic Pro and FL Studio as examples of compatible-format macOS hosts. Logic Pro is directed to AU. The README, installation script, developer notes and listener description now use DAW-neutral wording.
- Added the AU build target and bundled the complete streaming runtime into SessionStream.component, alongside the existing VST3. Both formats are ad-hoc signed and installed for the current user; no separate app is installed. Requirements remain native Apple Silicon and macOS 13.5+.
- macOS initially had not discovered the new component. After discovery, Apple's auval for aufx/Ssst/Ssau passed all validation checks. A native AU test host discovered and loaded the installed component, verified unchanged stereo passthrough, and exposed Send audio automation.
- Fifteen browser/audio checks passed against the actual installed AU, starting with the VST3 helper stopped. The AU launched its own embedded Node engine and anonymous Cloudflare tunnel. Public listener signaling, rendered stereo WebRTC and PCM, gain, single audible output, listener volume, stop/start and reconnect passed. Continuous playback had zero native underruns and trims.
- The rebuilt PKG was expanded and both plugin payloads passed deep strict code-signature verification. Both complete embedded runtimes, version 0.10.0 metadata and the packaged welcome/conclusion text were checked. macOS Installer installed the actual two-format PKG successfully into CurrentUserHomeDirectory; the installed AU and VST3 passed deep signature checks and both loaded successfully in the native test host.
- Evidence: artifacts/build-au-installer.log, artifacts/auval.log, artifacts/au-probe.log, artifacts/browser-au.log, artifacts/browser-au-report.json, artifacts/install-au-pkg.log, artifacts/au-package-probe.log and artifacts/vst3-au-package-probe.log.
- Logic Pro and FL Studio themselves have not been exercised. AU validation and native-host streaming establish format/runtime behavior, not confirmed behavior in every DAW/version.

Installer: `artifacts/SessionStream-0.10-mac-arm64.pkg`

SHA-256: `72bc263012f8662f7e38dea0e5e49a96108127d8ec80e3cb0135dc93903b72c5`

Plugin archive: `artifacts/SessionStream-mac-arm64.vst3.zip`

SHA-256: `e9ede630556c3ea94d6ffbd583f429c6521bbe9f86ec5ab94ab7b1c023d3f22a`

Not yet verified: the reporting client's exact browser/device, physical Safari/iOS audio, real client WAN WebRTC connections, long sessions, TURN operation or actual end-to-end latency. These checks establish the corrected playback routing and Chrome regression results; they do not establish worldwide reliability.
