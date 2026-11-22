# Native focus, fields and link creation

The account name had been deliberately hidden by icon-only rendering, with a fixed 82-point width. It now displays the existing account name alongside its icon and plan badge, using measured text width within the header. Account focus styling no longer paints a persistent lime border. Tab focus uses a subtle violet underline. Native buttons do not acquire keyboard focus on mouse clicks; keyboard access remains available.

A recursive editor mouse listener releases focus when clicking outside a text editor. The five main text fields (invite, passcode, custom name, Receive target and Receive passcode) now use zero vertical indent and border plus centered-left justification, so placeholders and entered text share the same vertical alignment at every field height. Text selection still works inside fields.

While the controller is generating a link, an editor-local blocking overlay shows a rotating violet arc, a short status and Cancel. All underlying plugin controls are disabled. The Cancel button remains keyboard accessible and Escape also cancels. Cancellation immediately stops requested audio and uses the existing controller End operation to invalidate pending/generated invitations. The overlay stays blocked during cancellation until the controller finishes. Success or cancellation restores the controls with their current state. The DAW itself is not placed in a modal loop.

Removed the idle analyzer's technical frequency-range subtitle. Frequency axis labels remain; the empty-state prompt now only says to play DAW audio or wait for an incoming stream.

Verified on the actual native editor with a fictional local Pro account, synthetic stereo audio and deliberately delayed tunnel readiness. No public tunnel or real account was used. Observed account name, centered Receive text and placeholder, click-away then typing without modifying the field, spinning arc at different angles, disabled underlying controls, Tab remaining on Cancel, cancellation returning to Ready, and successful creation restoring Copy/QR/transport controls. Compiled macOS AU/VST3/standalone and Windows x64/ARM64 VST3. Real DAW-hosted and Windows UI checks remain unverified.

Screenshots: /Users/jaxonhensch/wavesstreamvst/artifacts/plugin-listener-1.0.2/native-focus-fixed.png and native-link-loading.png.

The designed replacement installers are complete in artifacts/setup/. The DMG contains the exact rebuilt PKG and both setup/uninstaller signatures passed. Expanded AU/VST3 payloads match the rebuilt native binaries, contain the new loading UI and retain the current Keychain correction. Extracted Windows setup passed all 119 payload hashes and contains the new native UI in both x64 and ARM64 binaries plus its uninstaller. Final setup checksums passed. Nothing was installed into the system plugin folders.
