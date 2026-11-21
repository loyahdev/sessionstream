# SessionStream — installation and development notes

A VST3 audio effect for macOS Apple Silicon and Windows 11 x64/ARM64, with AU also included on macOS. The sender controls everything inside the plugin. Listeners open a private HTTPS invite and press **Start listening**; they install nothing.

## Install

Supported systems: macOS 13.5+ on Apple Silicon (VST3 + AU), and Windows 11 on Intel/AMD x64 or ARM64 (VST3). Most DAWs supporting these formats are compatible; use AU in Logic Pro. AAX, Intel Macs and 32-bit DAWs are not included. For Windows installation, see [WINDOWS.md](WINDOWS.md).

Open `SessionStream-mac-arm64.dmg` and launch SessionStream Setup. The same disk image includes Uninstall SessionStream. It installs VST3 into `~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3` and AU into `~/Library/Audio/Plug-Ins/Components/SessionStream.component`, each with its bundled runtime; it does not install a separate app. Requires Apple Silicon and macOS 13.5 or newer. Save and close your DAW before installing an update, then reopen it and rescan plugins if needed.

This build is ad-hoc signed. The installer is unsigned and not notarized because no Developer ID certificate is configured. Downloaded copies may require approval under macOS System Settings → Privacy & Security → Open Anyway. A notarized release needs Developer ID signing.

## Use in your DAW

Use AU in Logic Pro; VST3 or AU in Ableton Live and FL Studio. These are format-compatible hosts, not claims that every host/version has been tested. Run the DAW natively on Apple Silicon.

1. Put **SessionStream** on the audio track you want to share. Put it last on your Main/Master bus to share the whole mix.
2. Open the plugin and wait for **Preparing connection…** to finish. This checks the engine and public listener site. A cold connection can take tens of seconds; keep the window open while it prepares.
3. Optionally enable **Use passcode** and enter a code, then click **Start streaming**. The first private link is created automatically and the stream starts at the maximum Opus quality setting. No quality setup is required.
4. Click **Copy link** and send it to your listener, or **Show QR code** for a phone. Share any passcode separately. Your listener only needs to press **Start listening**.
5. Use **Stream output** to adjust only the outgoing level. **Stop streaming** pauses sharing and keeps the same invite. When stopped, **New link** invalidates the previous invite; **Create link** also lets you prepare an invite before streaming.

The stream gain changes only the outgoing copy. Your DAW track passes through unchanged. Gain is saved with the project, and streaming stays off when a saved project opens. Offline exports are never transmitted. One plugin owns an active session at a time, with up to eight listeners.

No sender browser, terminal, login, separately installed Node, or separate cloudflared installation is needed for the bundled plugin. The background engine runs while an enabled plugin uses it. Keep your computer awake and connected to the internet.

### Turning the plugin off

Disable/bypass SessionStream using your DAW's device switch, or remove it, to release its engine session. When no other enabled SessionStream instance is using the engine, the helper closes the tunnel, disconnects listeners and exits. Closing just the plugin window leaves the session running. Stop streaming pauses audio while the enabled plugin keeps its invitation available.

Explicit bypass normally closes the backend within about a second. Audio release/reprepare, processing suspension, offline bouncing, consolidation and export preserve the engine lease, invite, passcode and listener connections. Outgoing audio pauses during offline rendering and resumes with realtime playback, including after the host restores the plugin state. Silence, stopping playback and a host suspending an enabled idle track do not by themselves close its invitation. The plugin follows explicit host bypass signals rather than guessing from missing audio callbacks or audio-resource release. Hosts that only release audio resources for their device power switch retain the session until explicit bypass or plugin removal; see the validation notes for tested hosts. No audio is transmitted during offline export.

If the DAW crashes or a controller disappears without releasing its session, its heartbeat expires after five seconds; the helper checks every 250 ms and shuts down once no enabled clients remain. A helper abandoned during startup exits after eight seconds without any attached controller. The helper waits for its tunnel child to exit and forces termination if graceful shutdown fails. Re-enabling can create a fresh temporary hostname/invite and requires cold startup again; share the new link.

An old, idle SessionStream helper from 0.10 or 0.11 is retired automatically when 1.0 starts its engine. An active old broadcast is preserved; stop it first to allow the engine upgrade.

After updating the plugin, restart your DAW when convenient so it loads the new binary. Save your project first. Existing loaded instances can retain the previous version until the host restarts.

## Passcodes and listener errors

Passcodes are optional and apply to the invitation being generated. Changing the checkbox/text affects the next generated link; it does not silently change access to the current invite. A new invite disconnects previous listeners and resets its access code. Stop/start keeps the same invite and passcode. Passcodes are case-sensitive, held only in memory, and excluded from the URL, QR code, project state, diagnostics and saved browser storage. They are an additional gate on the existing private link, rather than user accounts.

Protected listeners enter the code before joining; wrong codes receive neither audio nor WebRTC connection details. Attempts are rate limited. A page reconnect remembers the authorized code only for that page session; reloads prompt again. The plugin shows an error notice only when a connected listener reports browser-blocked playback or interrupted reception. Healthy playback, intentional mute, silence and host pauses keep the normal status. Error reports clear on recovery and expire if the listener disappears.

## Listener playback

The listener shows a live waveform and source rate. Connection type, round-trip time, audio buffer and packet loss (or buffer resets) are available under **Connection details**. Listener volume starts at **0 dB** (unity gain), goes up to **+6 dB**, and decreases to silence at the slider's minimum. **Mute** silences output immediately while the connection, incoming audio and waveform stay active. Moving the slider while muted keeps output silent; unmuting restores the selected level. Volume/mute apply to both Live audio and Buffered audio and remain set when switching modes or restarting listening on the page.

On browsers exposing the AudioSession API (iOS 17+), listening requests the media `playback` category before starting or resuming audio, so the phone's silent switch does not mute it. Stopping restores the previous category. Both Live audio and Buffered audio retain a single audible Web Audio output. Browsers without this API continue normally; the silent-switch fix is not guaranteed on older iOS versions. Background/locked-phone playback is a separate browser limitation.

## Updates

The plugin checks `https://raw.githubusercontent.com/loyahdev/sessionstream/refs/heads/main/version.txt` in the background when an instance is added and when its window opens. The current display version is **1.0** (bundle/package version **1.0.0**). Put a plain dotted version such as `1.1` in that file to announce a newer release. `1.0` and `1.0.0` compare equal; `0.11` is older. Already-installed 0.11 plugins use the same integer comparison and can discover 1.0 without a special compatibility alias.

A newer version reveals **Get update** and **Ignore for this session** inside the plugin. Get update opens `https://github.com/loyahdev/sessionstream/releases/latest`; publish the new installer there before changing `version.txt`. Ignore hides update notices for plugin instances in the current DAW process; restarting the DAW allows notices again. Failed/offline/malformed checks stay quiet and do not interfere with streaming. The checker sends no session links or credentials, only an HTTPS request for the version file.

## Quality and connections

The default connection uses stereo Opus at a requested 510 kbps / 48 kHz with WebRTC encryption. Supported DAW source rates are 44.1, 48, 88.2, 96, 176.4 and 192 kHz. This is high-quality compressed audio, not lossless transmission. The native sender has a roughly 60 ms audio reservoir, followed by WebRTC, network and listener buffering; that is not an end-to-end latency measurement.

**Live audio** is recommended: high-quality stereo with less delay, requesting Opus at 510 kbps / 48 kHz. Actual encoding adapts to the connection. **Buffered audio** sends uncompressed stereo PCM through the HTTPS tunnel; choose it if Live audio will not connect or keeps cutting out. It uses more data and adds delay. A failed direct connection switches automatically and updates the selected mode. Technical statistics are available under **Connection details**.

Invites use a temporary Cloudflare Quick Tunnel hostname. They work over the public internet while this computer and its tunnel are online. Restarting the background engine or computer can change the hostname. This release does not provide permanent domains, an uptime guarantee, globally tested latency, or a managed TURN service. TURN credentials can be supplied through `TURN_URLS` and `TURN_SECRET` (coturn REST), or `TURN_URLS`, `TURN_USERNAME`, `TURN_PASSWORD` in the helper's environment.

## Build and install

Build on Apple Silicon, outside Rosetta, with macOS 13.5+, native Node.js 24+ and npm, CMake 3.22+, Xcode Command Line Tools, and a macOS arm64 cloudflared executable. With [Homebrew](https://brew.sh/) installed:

```sh
xcode-select --install # only if Command Line Tools are not installed; finish installation first
brew install node@24 cmake cloudflared
export PATH="$(brew --prefix node@24)/bin:$PATH"
```

With nvm, `nvm install` / `nvm use` reads the supplied `.nvmrc` instead. Confirm `node -p process.arch` prints `arm64`. Node and cloudflared are needed on the developer's machine to build; they ship inside the plugins for end users. Homebrew formula references: [Node 24](https://formulae.brew.sh/formula/node@24), [cloudflared](https://formulae.brew.sh/formula/cloudflared).

Run these commands from the repository root:

```sh
npm ci
npm test
npm run build:plugin
npm run build:installer
```

The first build downloads JUCE 8.0.12 and official Node v24.3.0 for macOS arm64 and verifies both archives. `npm ci` installs the locked dependencies, including the optional macOS arm64 WebRTC addon; do not use `--omit=optional`. The build bundles the server, listener, runtime and notices into VST3, AU and the development standalone app, then ad-hoc signs and verifies each bundle. It uses Command Line Tools when available. No ripgrep installation is required. cloudflared is found on `PATH`; for a custom location, run `CLOUDFLARED_PATH="/path/to/cloudflared" npm run build:plugin`.

Save and close your DAW before installing. `npm run install:plugin` installs both plugin formats into your user Library and preserves any previous bundles beside them with a timestamped `.backup-…` suffix. Opening the PKG also installs both formats, but the PKG replaces the previous installation without making that backup. Building the PKG does not require installing the plugins first.

- Plugin: `build/SessionStream_artefacts/Release/VST3/SessionStream.vst3`
- Audio Unit: `build/SessionStream_artefacts/Release/AU/SessionStream.component`
- Installed: `~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3` and `~/Library/Audio/Plug-Ins/Components/SessionStream.component`
- Designed setup: `artifacts/setup/SessionStream-Setup-1.0.2-mac-arm64.dmg`
- Intermediate package: `artifacts/SessionStream-mac-arm64.pkg`
- Plugin archive: `artifacts/SessionStream-mac-arm64.vst3.zip`
- Checksums: `artifacts/SHA256SUMS.txt`

## Verification and development

```sh
npm test
./build/plugin-smoke     # stop the bridge first; binds UDP 49300
./build/host-lifecycle   # native processor activation and bypass checks
npm run test:startup     # first click, helper replacement, passcodes and queued-start race
npm run test:render      # loading controls, repeated renders and actual VST3 recovery (stop other broadcasts first)
npm run test:browser     # actual VST3 auto-start → public invite → rendered stereo audio
npm run test:lifecycle   # actual VST3 → helper/tunnel exit → reactivation/crash checks
npm run test:access      # local protected/unprotected browser audio + listener errors
./build/qr-code artifacts/qr-code.png # render and validate a local QR image
```

`docs/VALIDATION.md` states what was tested and what remains unverified. Browser tests use synthetic quiet tones, check separate L/R energy, gain, reconnect, Buffered audio and stop/start. The old `/studio` broadcaster and `npm run start:tunnel` remain developer tools for the original browser sender; do not run them alongside the native plugin engine because they use the same local ports.

`npm test` runs isolated server, protocol, buffering, and worklet checks and does not create a public tunnel. `npm run test:browser` requires Google Chrome installed at its normal macOS location, an internet connection, and an idle SessionStream engine. It takes ownership of the normal plugin session and creates a temporary public tunnel; stop broadcasts first. Its reports go into ignored `artifacts/`. The optional `scripts/Start Browser Broadcaster.command` launcher is a legacy development tool, not part of plugin installation.

`npm test` also runs real helper-process cleanup checks using a local tunnel stub, so the suite remains independent of Cloudflare. `npm run test:lifecycle` exercises the real bundled runtime and tunnel and must run with no active broadcast. Its native test host checks bypass, idle-track preservation, pause/resume, deactivation, removal and a hard crash. Use `PLUGIN_PATH` to select an installed plugin bundle. Lifecycle results alone do not establish behavior in every DAW; see the validation notes for actual host checks.

## Preparing GitHub source and releases

```sh
npm run package:source
```

This produces `artifacts/SessionStream-source.zip` and a separate `.sha256` file. Extract it and upload the contents of its `SessionStream` folder to the repository. It includes the plugin, server, listener, tests, installer resources, documentation, lockfile and license. The exporter excludes dependencies, compiled products, local runtime state, environment files and logs; `.gitignore` also excludes them during normal Git use. Local build products remain on your machine.

Upload the PKG, VST3 ZIP and `SHA256SUMS.txt` as GitHub Release assets, rather than adding them to the source repository. The AU is included in the PKG; the standalone app is for development. Historical validation notes refer to local artifacts which are not part of a source checkout. Publish a new release before updating `version.txt`, and keep the version in `package.json`, `CMakeLists.txt`, `installer/Distribution.xml`, plugin UI/update checker and installer text consistent.

SessionStream's source is AGPL-3.0-only. See `LICENSE` and `docs/THIRD_PARTY.md` for dependencies and notices.

## Troubleshooting menu

Open **… → Troubleshooting → Copy diagnostics** in the plugin. The copied report includes version, OS, plugin architecture/format and connection state. The report includes controller events, audio lifecycle counters, and all retained engine, launcher and Cloudflare logs, even after the helper exits. Logs redact URLs and credentials before saving. Use **Export diagnostics and logs…** in the same menu to save the full report as JSON. Runtime logs rotate at 256 KiB per file, retaining three files each for the engine and launcher, so long sessions cannot fill the disk. The **Compatibility** menu item lists supported operating systems and DAW formats.

The browser retries a failed audio-engine module load once. If it still fails, it gives instructions to reload, check the connection or obtain a fresh invite.

### Native UI styles

The native editor uses vendored JIVE 1.2.0 core/components/stylesheets (MIT, pinned in `vendor/JIVE/UPSTREAM.md`) for button backgrounds and interaction selectors. `ModernButton.h` retains JUCE button accessibility, keyboard operation and callbacks while drawing content above the JIVE skin. `StudioLookAndFeel.h` defines the shared Inter typeface and field/menu/knob rendering. Inter is embedded for consistent metrics on Mac and Windows. No WebView is required.

UI backup bundles and source snapshots are under `artifacts/ui-backups/`. Build and run `invite-editor` through `node --expose-gc tests/editor-workflow.mjs` to check the real interface with an isolated account.

The compact native editor is 860 × 510 (plus an optional 62 px update banner). A fresh helper always starts in random-code mode; custom-name ownership and authorization still restore, but link-type selection is not persisted. Session and Settings are stable inline views. Active and paused session settings remain readable but locked; receive failures expose editable fields with Retry/Cancel. The UI analyser uses a 16384-sample stereo FFT and fractional Gaussian frequency-band averaging; all analysis runs on the message thread. Verify its band mapping with `clang++ -std=c++17 tests/spectrum-analysis.cpp -o /tmp/spectrum-analysis && /tmp/spectrum-analysis`.

### Session setup and monitoring

Settings offers Studio (510 kbps), Balanced (320 kbps), and Phone (96 kbps) stereo Opus presets. Buffered transport remains uncompressed. New sessions have no automatic expiry. Pause/Resume retains the same invite, connected listeners, and existing WebRTC peers (the sender emits silence while paused); End session closes listeners, revokes the current room, clears its passcode and resets link type to Random without releasing a saved custom name. End requires an inline second click, not a dialog. Control protocol 5 upgrades idle older helpers without interrupting an active broadcast. Legacy explicit expiry requests remain supported at the API boundary only.

The local monitoring mute is applied after stream capture with a 10 ms ramp, only while sending; it never affects listener PCM or offline render output. The elapsed timer comes from the helper start timestamp. The editor now invalidates dynamic regions instead of repainting/resizing the full editor on each 20 Hz tick. Quality restores from 17-byte plugin state; the legacy expiry field is consumed but ignored. Legacy 4-byte and 9-byte state remains compatible.

Verification: `build/local-monitor`, `node --expose-gc tests/native-quality.mjs`, `node --expose-gc tests/session-end-browser.mjs`, the Node suite, and the isolated native editor workflow.

Programmatic button-state synchronization uses `studio::syncToggleState`: the bundled JUCE implementation ignores `setToggleState` on disabled controls, so locked controls must be briefly enabled while updating their model state, then restored. This prevents stale passcode and mode/mute indicators after End or mode changes.
