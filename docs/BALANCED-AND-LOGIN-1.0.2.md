# Balanced-only Free preset and account menu cleanup

Removed subscription management and upgrade actions from the native account dropdown. Open account dashboard remains the route for billing/account changes.

Balanced (320 kbps stereo) is now the sole visible preset for Free and signed-out accounts. Studio and Phone are hidden. The processor/controller default is Balanced, and the controller forces Balanced unless the current account is signed in with confirmed Pro. Restored Pro-quality settings cannot carry into an unauthenticated stream. The companion rejects Pro presets for signed-out/Free accounts, including attempts to restart an existing Pro-quality invite after its plan refreshes to Free. Pro keeps all three presets. Tests use an authenticated Pro fixture for Pro-only quality/expiry behavior.

Explicit browser sign-in now saves the refresh token and then checks a fresh noninteractive helper read. Failure is reported as session-only sign-in in account status rather than suggesting persistence succeeded. Background access still cannot open password prompts.

The installed AU and VST3 credential helpers both returned authorization-required exit status 3 during a silent restore probe. Only status flags were printed; credential values were not printed or changed. This confirms that Keychain authorization is blocking restore, without distinguishing every possible ACL/locked-keychain cause.

A proposed Keychain access repair is staged at /Users/jaxonhensch/wavesstreamvst/native-102-work/credential-trust-repair.patch. It is NOT applied or included. Automatic approval review rejected the original access-control change because it could broaden access to the saved token and requested explicit approval. A concrete single-application trust list is prepared, syntax-checked in an independent review copy, and awaiting the user's answer to the pending approval question.

175 serial regression tests passed. Native plugin builds succeeded for macOS AU/VST3/standalone and Windows x64/ARM64 VST3. Native visual verification could not complete because computer-use access timed out; the source gates and real companion API tests passed. Real account restart persistence is not fixed or claimed verified while the permission repair remains pending.

The login Keychain status was checked separately and is unlocked; no credentials were changed. The persistent-login repair is still pending explicit approval.

The completed menu/preset packages are in artifacts/setup/. Extracted macOS plugin signatures, exact current native binaries and runtime sources passed. Both DMG setup apps pass signature checks and its embedded PKG matches the new release. The Windows setup passed all 119 payload hashes and both native binaries omit the billing/upgrade menu strings. Final setup checksums passed. Building setup required the installed full Xcode toolchain because the command-line-only toolchain lacked the SDK's SwiftUI macro plugin. No system installation was performed.
