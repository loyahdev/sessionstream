# SessionStream 1.0.2

- Redesigned native plugin, browser listener, sign-in and account confirmation pages.
- Designed macOS Setup/Uninstall DMG and combined Windows x64/ARM64 setup with an uninstaller.
- Account names, click-away focus, aligned fields and cancellable link creation.
- Free and signed-out accounts use Balanced (320 kbps stereo); Pro also offers Studio (510 kbps) and Phone (96 kbps).
- Background Keychain access stays silent. macOS setup can request optional saved-account access when needed and verifies it from a fresh process. Installation does not reset Keychain credentials or rewrite access lists.
- Successful plugin login opens a clean completion URL. Repeating an exact completed callback does not exchange its code again or display a false failure.

Recommended installers: SessionStream-mac-arm64.dmg and SessionStream-windows-x64-arm64.exe. Save and close the DAW before installing. macOS requires Apple Silicon and macOS 13.5+; AU/VST3 are included. Windows requires Windows 11 x64 or ARM64 with VST3. The ARM64 plugin uses an x64 companion runtime through Windows 11 emulation.

The macOS build is ad hoc signed and not notarized; Windows binaries are not Authenticode signed. Automated tests and package integrity checks do not replace clean-machine or Windows DAW testing. Cloud Relay for larger classes is planned and unavailable in the current plans.
