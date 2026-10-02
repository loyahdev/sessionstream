# SessionStream — installation and development notes

A VST3 audio effect for macOS Apple Silicon and Windows 11 x64/ARM64, with AU also included on macOS. The sender controls everything inside the plugin. Listeners open a private HTTPS invite and press **Start listening**; they install nothing.

## Install

Supported systems: macOS 13.5+ on Apple Silicon (VST3 + AU), and Windows 11 on Intel/AMD x64 or ARM64 (VST3). Most DAWs supporting these formats are compatible; use AU in Logic Pro. AAX, Intel Macs and 32-bit DAWs are not included. For Windows installation, see [WINDOWS.md](WINDOWS.md).

Open `SessionStream-0.30-mac-arm64.pkg` and complete the macOS Installer. It installs VST3 into `~/Library/Audio/Plug-Ins/VST3/SessionStream.vst3` and AU into `~/Library/Audio/Plug-Ins/Components/SessionStream.component`, each with its bundled runtime; it does not install a separate app. Requires Apple Silicon and macOS 13.5 or newer. Save and close your DAW before installing an update, then reopen it and rescan plugins if needed.

This build is ad-hoc signed. The installer is unsigned and not notarized because no Developer ID certificate is configured. Downloaded copies may require approval under macOS System Settings → Privacy & Security → Open Anyway. A notarized release needs Developer ID signing.

## Use in your DAW

Use AU in Logic Pro; VST3 or AU in Ableton Live and FL Studio. These are format-compatible hosts, not claims that every host/version has been tested. Run the DAW natively on Apple Silicon.

1. Put **SessionStream** on the audio track you want to share. Put it last on your Main/Master bus to share the whole mix.
2. Open the plugin. If you want a protected invite, enable **Use passcode** and enter up to 64 characters before clicking **Generate share link**. Opening the editor starts preparing its bundled engine and anonymous Cloudflare tunnel. The first click stays pending until the public listener site answers twice and also passes a health check using normal system DNS, all against this running engine. Startup progress appears in the plugin; no reload is required. A cold tunnel can take tens of seconds, depending on Cloudflare and DNS. Once ready, later invitations are much quicker.
3. Click **Copy link** and send it to your client, or **Generate QR code** to display a code for your phone camera. The QR code is created locally from the current link and never includes the passcode; share that separately.
4. Set **Stream output** in dB, then click **Start streaming**. L/R meters display the level sent to clients, in dBFS. Red means clipping; reduce the stream level.
5. Click **Stop streaming** to silence listeners. The same invite works when you start again. **Generate share link** creates a new invitation and invalidates the previous one.

The stream gain changes only the outgoing copy. Your DAW track passes through unchanged. Gain is saved with the project, and streaming stays off when a saved project opens. Offline exports are never transmitted. One plugin owns an active session at a time, with up to eight listeners.

No sender browser, terminal, login, separately installed Node, or separate cloudflared installation is needed for the bundled plugin. The background engine runs while an enabled plugin uses it. Keep your computer awake and connected to the internet.

### Turning the plugin off

Disable/bypass SessionStream using your DAW's device switch, or remove it, to release its engine session. When no other enabled SessionStream instance is using the engine, the helper closes the tunnel, disconnects listeners and exits. Closing just the plugin window leaves the session running. Stop streaming pauses audio while the enabled plugin keeps its invitation available.

Explicit bypass and host deactivation normally close the backend within about a second. Silence, stopping playback and a host suspending an enabled idle track do not by themselves close its invitation. The plugin follows host bypass/deactivation signals rather than guessing from missing audio callbacks. The host must communicate its power switch through its VST3/AU bypass or activation hooks; see the validation notes for tested hosts. No audio is transmitted during offline export.

If the DAW crashes or a controller disappears without releasing its session, its heartbeat expires after five seconds; the helper checks every 250 ms and shuts down once no enabled clients remain. A helper abandoned during startup exits after eight seconds without any attached controller. The helper waits for its tunnel child to exit and forces termination if graceful shutdown fails. Re-enabling can create a fresh temporary hostname/invite and requires cold startup again; share the new link.

An old, idle SessionStream helper from 0.10 or 0.11 is retired automatically when 0.30 starts its engine. An active old broadcast is preserved; stop it first to allow the engine upgrade.

After updating the plugin, restart your DAW when convenient so it loads the new binary. Save your project first. Existing loaded instances can retain the previous version until the host restarts.

## Passcodes and listener errors

Passcodes are optional and apply to the invitation being generated. Changing the checkbox/text affects the next generated link; it does not silently change access to the current invite. A new invite disconnects previous listeners and resets its access code. Stop/start keeps the same invite and passcode. Passcodes are case-sensitive, held only in memory, and excluded from the URL, QR code, project state, diagnostics and saved browser storage. They are an additional gate on the existing private link, rather than user accounts.

Protected listeners enter the code before joining; wrong codes receive neither audio nor WebRTC connection details. Attempts are rate limited. A page reconnect remembers the authorized code only for that page session; reloads prompt again. The plugin shows an error notice only when a connected listener reports browser-blocked playback or interrupted reception. Healthy playback, intentional mute, silence and host pauses keep the normal status. Error reports clear on recovery and expire if the listener disappears.

## Listener playback

The listener shows a live waveform, audio format/source rate, connection type, round-trip time, audio buffer and packet loss (or compatibility-buffer resets). Listener volume starts at **0 dB** (unity gain), goes up to **+6 dB**, and decreases to silence at the slider's minimum. **Mute** silences output immediately while the connection, incoming audio and waveform stay active. Moving the slider while muted keeps output silent; unmuting restores the selected level. Volume/mute apply to both low-delay and compatibility audio and remain set when switching modes or restarting listening on the page.

On browsers exposing the AudioSession API (iOS 17+), listening requests the media `playback` category before starting or resuming audio, so the phone's silent switch does not mute it. Stopping restores the previous category. Both WebRTC and compatibility audio retain a single audible Web Audio output. Browsers without this API continue normally; the silent-switch fix is not guaranteed on older iOS versions. Background/locked-phone playback is a separate browser limitation.

## Updates

The plugin checks `https://raw.githubusercontent.com/loyahdev/sessionstream/refs/heads/main/version.txt` in the background when an instance is added and when its window opens. The current display version is **0.30** (bundle/package version **0.30.0**). Put a plain dotted version such as `0.31` in that file to announce a newer release. `0.30` and `0.30.0` compare equal; `0.11` is older. Already-installed 0.11 plugins use the same integer comparison and can discover 0.30 without a special compatibility alias.

A newer version reveals **Get update** and **Ignore for this session** inside the plugin. Get update opens `https://github.com/loyahdev/sessionstream/releases/latest`; publish the new installer there before changing `version.txt`. Ignore hides update notices for plugin instances in the current DAW process; restarting the DAW allows notices again. Failed/offline/malformed checks stay quiet and do not interfere with streaming. The checker sends no session links or credentials, only an HTTPS request for the version file.

## Quality and connections

The default connection uses stereo Opus at a requested 320 kbps / 48 kHz with WebRTC encryption. Supported DAW source rates are 44.1, 48, 88.2, 96, 176.4 and 192 kHz. This is high-quality compressed audio, not lossless transmission. The native sender has a roughly 60 ms audio reservoir, followed by WebRTC, network and listener buffering; that is not an end-to-end latency measurement.

WebRTC attempts a direct connection. If the listener's network prevents that, it automatically switches to PCM over the public HTTPS/WebSocket tunnel. The client can also select **Use compatibility audio**. Compatibility mode uses substantially more bandwidth and usually adds delay, but does not require inbound ports or a listener download.

Invites use a temporary Cloudflare Quick Tunnel hostname. They work over the public internet while this computer and its tunnel are online. Restarting the background engine or computer can change the hostname. This prototype does not yet provide permanent domains, an uptime guarantee, globally tested latency, or a managed TURN service. TURN credentials can be supplied through `TURN_URLS` and `TURN_SECRET` (coturn REST), or `TURN_URLS`, `TURN_USERNAME`, `TURN_PASSWORD` in the helper's environment.

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
- Installer: `artifacts/SessionStream-0.30-mac-arm64.pkg`
- Plugin archive: `artifacts/SessionStream-mac-arm64.vst3.zip`
- Checksums: `artifacts/SHA256SUMS.txt`

## Verification and development

```sh
npm test
./build/plugin-smoke     # stop the bridge first; binds UDP 49300
./build/host-lifecycle   # native processor activation and bypass checks
npm run test:browser     # actual VST3 auto-start → public invite → rendered stereo audio
npm run test:lifecycle   # actual VST3 → helper/tunnel exit → reactivation/crash checks
npm run test:access      # local protected/unprotected browser audio + listener errors
./build/qr-code artifacts/qr-code.png # render and validate a local QR image
```

`docs/VALIDATION.md` states what was tested and what remains unverified. Browser tests use synthetic quiet tones, check separate L/R energy, gain, reconnect, compatibility mode and stop/start. The old `/studio` broadcaster and `npm run start:tunnel` remain developer tools for the original browser sender; do not run them alongside the native plugin engine because they use the same local ports.

`npm test` runs isolated server, protocol, buffering, and worklet checks and does not create a public tunnel. `npm run test:browser` requires Google Chrome installed at its normal macOS location, an internet connection, and an idle SessionStream engine. It takes ownership of the normal plugin session and creates a temporary public tunnel; stop broadcasts first. Its reports go into ignored `artifacts/`. The optional `scripts/Start Browser Broadcaster.command` launcher is a legacy development tool, not part of plugin installation.

`npm test` also runs real helper-process cleanup checks using a local tunnel stub, so the suite remains independent of Cloudflare. `npm run test:lifecycle` exercises the real bundled runtime and tunnel and must run with no active broadcast. Its native test host checks bypass, idle-track preservation, pause/resume, deactivation, removal and a hard crash. Use `PLUGIN_PATH` to select an installed plugin bundle. Lifecycle results alone do not establish behavior in every DAW; see the validation notes for actual host checks.

## Preparing GitHub source and releases

```sh
npm run package:source
```

This produces `artifacts/SessionStream-0.30-source.zip` and a separate `.sha256` file. Extract it and upload the contents of its `SessionStream` folder to the repository. It includes the plugin, server, listener, tests, installer resources, documentation, lockfile and license. The exporter excludes dependencies, compiled products, local runtime state, environment files and logs; `.gitignore` also excludes them during normal Git use. Local build products remain on your machine.

Upload the PKG, VST3 ZIP and `SHA256SUMS.txt` as GitHub Release assets, rather than adding them to the source repository. The AU is included in the PKG; the standalone app is for development. Historical validation notes refer to local artifacts which are not part of a source checkout. Publish a new release before updating `version.txt`, and keep the version in `package.json`, `CMakeLists.txt`, `installer/Distribution.xml`, plugin UI/update checker and installer text consistent.

SessionStream's source is AGPL-3.0-only. See `LICENSE` and `docs/THIRD_PARTY.md` for dependencies and notices.

## Troubleshooting menu

Open **… → Troubleshooting → Copy diagnostics** in the plugin. The copied report includes version, OS, plugin architecture/format and connection state. Private invites, passcodes, tokens and free-form engine errors are excluded. The **Compatibility** menu item lists supported operating systems and DAW formats.

The browser retries a failed audio-engine module load once. If it still fails, it gives instructions to reload, check the connection or obtain a fresh invite.
