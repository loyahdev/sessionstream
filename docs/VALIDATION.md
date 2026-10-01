# Validation notes

## 0.20: protected invites, local QR codes and listener errors

Verified on this Apple Silicon Mac on September 30, 2026 (America/Edmonton):

- All 33 isolated Node tests passed. Coverage includes passcode verification, Unicode/bounded JSON requests, rate limiting, idempotent invitation retries, blocked unauthenticated signaling, cross-listener signaling isolation and the existing engine/tunnel cleanup checks.
- Nine local Chrome access checks passed with actual native stereo RTP/PCM. Protected pages prompt before joining; incorrect codes receive no peer or audio; correct same-socket retries and page reconnects work. Tests cover browser-blocked playback, genuine interrupted reception, recovery, expected host pauses, mute, phone-width layout and no browser runtime errors. Compiling the whole native project concurrently caused one initial audio startup timeout; the rerun after compilation passed.
- Four public-link checks passed using the actual native plugin editor and its bundled runtime with synthetic stereo audio: wrong-code blocking, correct-code rendered audio, compatibility PCM, hard mute, browser error propagation into the native status and clearing after Resume. Native editor logs confirm the warning appears and returns to healthy status. This used desktop Chrome at phone width; it does not establish physical iPhone behavior.
- Native controller tests passed delayed first-generation readiness, lost POST acknowledgements, failed status reads, engine replacement, protected restart/bypass recovery and explicit passcode removal. Protected audio never starts before its access code is restored.
- The actual plugin QR component passed exact-URL encoding, integer pixels, white quiet-zone and error checks. macOS Vision independently decoded the generated image to the exact invite, including its fragment. The final native QR overlay was inspected and closing the editor with it open exited normally.
- Native audio and host lifecycle checks passed unchanged stereo passthrough, outgoing gain, UDP packet delivery, state restore, complete 8192-frame bursts, bypass/deactivation, offline export, concurrency and enabled idle-track preservation.
- The original UpdateChecker compiled directly from the hash-verified 0.11 source ZIP recognized 0.20 and made its update notice available. The final 0.20 checker passed integer version comparisons, malformed/offline replies, future updates and session dismissal. Its live GitHub check still returned 0.11 during validation; upload version.txt and publish the 0.20 release to announce it publicly.
- The 0.20 PKG was expanded and both VST3/AU payloads passed strict deep signature checks with the protected listener/server and QR license included. The PKG then successfully upgraded the actual installed 0.11 VST3 and AU to 0.20.0 in the user Library. Old bundles were preserved as timestamped backups before this test; the installer itself performs replacement. Installed binaries/server/listener match the final build. The installed AU loaded in the native host and passed stereo passthrough and automation checks.
- All 18 public-browser checks passed using the VST3 installed by the final PKG: actual stereo WebRTC/PCM audio, sole audible output, unity/+6/-6 dB, silent minimum, hard mute while receiving, waveform, stop/start, reconnect, two listeners, unsupported-rate rejection and phone-width user-gesture activation. Its engine reported zero underruns and trims during this short test.
- The README screenshot was refreshed from the final 0.20 editor without an invite URL or passcode. Runtime packaging excludes Finder metadata.

Evidence is saved locally in `artifacts/tests-final-0.20.log`, `artifacts/access-browser-report.json`, `artifacts/public-protected-report.json`, `artifacts/invite-editor-0.20.log`, `artifacts/controller-protected-recovery-0.20.log`, `artifacts/qr-code-0.20.log`, `artifacts/legacy-updater-0.20.log`, `artifacts/updater-0.20.log`, `artifacts/installer-final-0.20-report.json` and `artifacts/installed-0.20-report.json` and `artifacts/browser-report.json`. Build/test reports are intentionally excluded from source exports.

The installer remains Apple Silicon/macOS 13.5+, with ad-hoc signed plugins and an unsigned, non-notarized PKG. Physical iOS/Safari, client WAN media paths, long sessions, TURN, actual end-to-end latency, Logic Pro and FL Studio remain unverified. A public Cloudflare invite and local rendered audio do not establish worldwide reliability.

## 0.11: plugin shutdown and listener controls

Verified on this Apple Silicon Mac on September 30, 2026 (America/Edmonton):

- Twenty-five Node tests passed, including authenticated private engine leases, owner/invite release, multiple enabled instances, actual helper/tunnel-child termination, five-second lost-controller recovery and eight-second abandoned-startup cleanup. Process cleanup tests use a local tunnel stub, without a Cloudflare dependency.
- Native processor checks passed host bypass, the legacy bypass callback, host deactivation/reset, offline export, concurrent activation and preservation of enabled idle tracks. Native audio checks passed unchanged stereo passthrough, stream gain, UDP PCM delivery, safe state restore and complete 8192-frame bursts. Numeric update checking and controller retry/replacement checks passed.
- Worker threads now finish their macOS autorelease cleanup and join before the processor/module can be deleted. An actual VST3 removal test exposed the earlier cleanup race; after correction it exited normally and both helper and tunnel PIDs disappeared. Actual VST3 bypass, deactivation, reactivation with a fresh invite and a hard host crash also passed.
- In Ableton Live 12 Suite, switching off the VST3's Device Activator and removing the device closed both managed processes without a DAW crash. Re-enabling/reopening the editor started fresh processes. Closing only the editor, stopped transport and a silent main output retained the enabled session. These were temporary test-session changes, discarded without modifying a saved project.
- The final installed AU also passed actual bundled-runtime checks: stop/start retains its invite, bypass/deactivation/removal shut down both processes in about 0.2-0.3 seconds, reactivation creates a fresh invite, enabled idle tracks remain available and a killed host cleans up after about 5.2 seconds. These are individual local measurements.
- On the final VST3 in Ableton, an empty enabled audio track kept both managed processes alive with stopped transport and the editor closed beyond six seconds. Switching its Device Activator off closed both processes and its private API. The temporary test device was removed and the unsaved test session discarded.
- The final installer was expanded. Both plugin payloads passed deep strict signature verification, reported version 0.11.0, matched the installed native binaries and included listener/lifecycle modules byte-identical to the current source. The matching signed bundles were installed using the backup-preserving script; this final PKG was inspected rather than installed through macOS Installer again.
- Eighteen public-listener browser checks passed against the installed VST3. Listener gain starts at 0 dB/unity, +6 dB approximately doubles rendered amplitude, and -6 dB approximately halves it. The minimum and hard mute produce silence. Both WebRTC and PCM keep receiving while muted, retain the selected slider level and keep the incoming waveform active. Mute and level survive audio-mode changes and listener stop/start. The decoder remains explicitly muted, with one audible Web Audio output.
- Browser checks also passed separate stereo channels, plugin gain, network reconnect, broadcaster stop/start with the same invite, mobile-width layout and no runtime errors. Continuous native playback recorded zero underruns and trims. PCM checks wait for actual rendered audio after its startup buffer primes, rather than treating the first packet as playback.
- Isolated Chrome checks passed stereo playback and mobile layout with supported, absent and rejecting simulated AudioSession APIs. These simulations retain the earlier phone-playback fix; they do not verify a physical iPhone.
- The helper is used only by enabled plugin controllers. Listener connections and status requests cannot keep it alive after all controllers detach or expire. Stop streaming keeps an enabled session available; bypass/deactivation/removal releases it. Silence or an enabled idle track does not itself mean the device is off. Host power switches must use VST3/AU bypass or activation hooks.
- Upgrade checks preserved an active 0.10 broadcast, automatically retired an idle installed 0.10 helper when 0.11 started, and verified cleanup when removing the new plugin during startup.

Evidence: `artifacts/tests-lifecycle-0.11.log`, `artifacts/native-lifecycle-0.11.log`, `artifacts/runtime-lifecycle-report.json`, `artifacts/runtime-lifecycle-au-report.json`, `artifacts/installer-final-0.11-report.json`, `artifacts/ableton-lifecycle-report.json`, `artifacts/legacy-upgrade-report.json`, `artifacts/browser-volume-mute-0.11.log`, `artifacts/browser-report.json` and `artifacts/browser-playback-session-0.11.log`. These local artifacts are intentionally excluded from source exports.

The installer remains Apple Silicon/macOS 13.5+, with ad-hoc signed plugin/runtime binaries. The PKG is unsigned and is not notarized. Physical iOS/Safari, client WAN media paths, long sessions, TURN, actual end-to-end latency, Logic Pro and FL Studio remain unverified. VST3/AU support does not establish behavior in every DAW/version.

## 0.10 verification history

Recorded September 30, 2026 (America/Edmonton). The details and hashes below are historical; use the current build's `artifacts/SHA256SUMS.txt` for current artifacts.

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
- The plugin was installed at ~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3, preserving the previous installed bundle. At the time of that check, the test tunnel was running with streaming off.

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

Installer from the DAW compatibility check, before source cleanup: `artifacts/SessionStream-0.10-mac-arm64.pkg`

SHA-256: `72bc263012f8662f7e38dea0e5e49a96108127d8ec80e3cb0135dc93903b72c5`

Plugin archive from that check: `artifacts/SessionStream-mac-arm64.vst3.zip`

SHA-256: `e9ede630556c3ea94d6ffbd583f429c6521bbe9f86ec5ab94ab7b1c023d3f22a`

Source cleanup and clean source-build verification:

- An extracted source export, without vendor dependencies, node_modules or a build directory, completed the documented `npm ci`, `npm test`, `npm run build:plugin` and `npm run build:installer` sequence. All eighteen Node tests passed. JUCE and bundled Node archives were downloaded and their checksums verified.
- VST3, AU and the development standalone app built for native arm64 with macOS 13.5 as the deployment target and passed deep strict ad-hoc signature verification. The freshly compiled native smoke test passed stereo passthrough, UDP packet delivery, stream gain, safe state restore and the complete 8192-frame burst. The VST3 extracted from the installer was discovered and loaded by the native test host and passed stereo passthrough and automation checks.
- The final saved PKG was expanded and both VST3 and AU payloads passed deep strict signature verification. Bundled cloudflared and JUCE license notices are now included. This PKG was inspected, not installed into a DAW again; streaming and phone/browser behavior were not rerun for this documentation/build cleanup.
- The local macOS `pkgbuild` prints four `write: Permission denied` messages, including when packaging a single plain text file unrelated to SessionStream. It exits successfully and produces a readable installer with verified plugin payloads. This is a local packaging-environment warning, not a failed source build.
- Local documentation links and JavaScript/shell syntax were checked. Git ignore checks exclude dependencies, vendor downloads, build products, local runtime state, environment files and logs. The clean source ZIP includes only project source, installer resources, tests, documentation, screenshots, license and lockfile. A scan found no private keys, real credentials or user-specific absolute paths in those source files; the documentation screenshots show no invite URL.
- Current local installer SHA-256: `248c7d9834cfeedada45668af5443213bbf44eab5eaae2da459f636c1ec0ba0f`.
- Current local VST3 archive SHA-256: `3253c58fb60363a0287effcde34626f6cbbddbb1beae574f1e57baf566ca18a3`. Check `artifacts/SHA256SUMS.txt` after rebuilding; build artifacts are intentionally not committed.

Not yet verified: the reporting client's exact browser/device, physical Safari/iOS audio, real client WAN WebRTC connections, long sessions, TURN operation or actual end-to-end latency. These checks establish the corrected playback routing and Chrome regression results; they do not establish worldwide reliability.
