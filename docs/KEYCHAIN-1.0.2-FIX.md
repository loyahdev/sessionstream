# Keychain prompt loop correction

The native helper previously allowed Keychain interaction during all read/write/delete operations. The companion killed each request after 15 seconds. Restoring login, rotating tokens and retrying installation enrollment could therefore reopen authorization UI in the background. This explains a concrete loop mechanism; the user's existing item ACL and whether they selected Allow or Always Allow were not inspected.

The helper now disables optional Keychain interaction by default, including legacy login-keychain ACL dialogs. Authentication-required, rejected and cancelled access returns a distinct exit status. The companion interprets it as a reconnect requirement. Background installation enrollment stops retrying after this result, while preserving the saved device registration. An explicit completed browser sign-in can authorize login persistence and installation access; explicit sign-out can authorize removal. Those interactive requests have a two-minute deadline. Background refresh and custom-link exchange remain silent. Secure storage and its access controls remain in place.

Verified:

- 173 serial regression tests passed, including background/interactive policy, restoring after denial, stopping enrollment retries, and preservation of the existing device on reconnect.
- Native macOS helper read/write/token rotation/ordered cleanup passed using a randomly named test credential. No existing user credential was read, changed or deleted by that test.
- macOS and Windows x64 credential helpers rebuilt; the shared Windows helper serves both plugin architectures.
- The designed 1.0.2 installers were regenerated with the new helpers and companion sources. Extracted macOS plugin signatures and current server/listener source integrity passed; both packaged helpers performed a random missing-credential lookup silently. The DMG contains the exact fixed PKG and both setup/uninstaller signatures passed. All 119 Windows installer payload hashes and final setup checksums passed. Outputs are in artifacts/setup/.

A real account requiring Keychain authorization and a DAW-hosted install have not been exercised by the agent. The old running helper must exit (save and close the DAW) before the replacement can take effect.
