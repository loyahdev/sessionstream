# SessionStream 1.0.3

Cloud streaming, account balances and explicit audio-format controls are packaged together in this refreshed 1.0.3 build. Reinstall the updated package if you already installed an earlier 1.0.3 build.

- Format controls replace Studio/Balanced/Phone labels: Opus 96, 128, 192, 256, 320 or 510 kbps in mono/stereo; PCM 16/24-bit integer or 32-bit float in mono/stereo/5.1/7.1 at the DAW sample rate (44.1–192 kHz). Surround needs a matching DAW bus.
- Direct and Cloud preserve the selected PCM layout and bit depth. Browser outputs with too few channels use labelled stereo monitoring.
- Older project state remains readable. Protocol 8 updates idle older helpers before starting a new-format session.
- Free accounts receive no monthly included Cloud hours. Current service policy requires active Pro for Cloud and top-up checkout. Purchased or administrator-granted credits are retained after a downgrade and become usable after Pro reactivation. Pro controls remain unavailable on Free.
- Pro includes 300 Cloud listener-hours per billing month by default. Its Cloud sessions are metered by listener-hours without a listener-count cap. Direct sessions allow eight listeners.
- Billing-month renewals refill only included hours. Unused top-ups carry forward. Annual plans receive monthly refills on their billing anniversary.
- Clerk private metadata supports `cloudMonthlyRenewHours` and administrator edits to `cloudTopupHoursRemaining`; `cloudNormalHoursRemaining` is calculated. The dashboard sums the buckets. The obsolete editable total is removed.
- Tester accounts use separate Stripe sandbox checkout through the normal purchase button. Sandbox purchases fund Cloud only for authorized testers and never grant Pro features.
- Direct/Cloud selection, default endpoint encryption, pause/resume, native Receive, listener access controls and account persistence ship in the bundled runtime.
- The macOS DMG includes the custom setup and uninstaller. Windows setup includes native x64 and ARM64 VST3 binaries and the offline runtime. Windows ARM64 uses an x64 helper under Windows 11 emulation.

## Verification

- 323 automated tests passed, including account isolation, Free/Pro restrictions, quota and monthly renewal accounting, editable top-ups, encryption, decoding, reconnect and lifecycle behavior.
- The exact macOS VST3 and AU bundles loaded in the native host probe with unchanged mono, stereo, 5.1 and 7.1 passthrough. The AU test registers the tested bundle under a process-local identity to avoid loading an older installed component.
- Native processor tests cover UDP PCM, independent gain, state restoration, Receive output and prevention of re-broadcast loops. Opus negotiation passed at every exposed bitrate in mono and stereo. Native channel-routing tests preserve mono, stereo, 5.1 and 7.1 through the sender, project state and DAW receiver.
- The packaged Node/runtime passed Direct and Cloud audio with encryption on and off, including pause/resume.
- Compiled native seek tests and the actual VST3 wrapper preserved the protected invite/listener through offline exports and resource reinitialization, sent no offline audio, and resumed encrypted playback.
- Windows x64 and ARM64 binaries were freshly cross-compiled and their resource versions/PE architectures validated. The x64 processor and actual VST3 host probes also passed under Wine. The extracted Windows installer matched the staged payload files.
- The DMG checksum, setup/uninstall signatures and embedded package identity were checked.

## Limits of this release verification

The Mac build is ad-hoc signed and is **not Developer ID signed or notarized**; downloaded installers may be blocked by Gatekeeper. Windows setup is unsigned and may show reputation warnings. No signing identity was available on the build machine.

Wine checks do not establish native Windows DAW compatibility. Fresh-machine installation, Intel Mac support, physical surround-interface mapping, physical Windows DAW execution and large real classroom/network tests were not performed. This release does not claim that every host/network combination has been verified. Top-up refunds and disputes require manual support handling.

Close your DAW before installing or uninstalling. Supported release targets: Apple Silicon macOS 13.5+, and Windows 11 x64/ARM64.
