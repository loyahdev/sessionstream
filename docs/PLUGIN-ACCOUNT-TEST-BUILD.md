# SessionStream 1.0 account integration test build

The existing Clerk PKCE login and rotating refresh-token system now connect to
`https://sessionstream.app/api/account/plugin/v1/enroll` and `/v1/report`.
Installation ID and credential are stored together in the existing native
credential helper, under an issuer/client/account-specific key. No credential
is written to a runtime JSON file. Reconnect explicitly replaces a revoked ID.

The shared companion owns one run, sequence and cumulative UTC-day counters.
It sends a zero report before claiming the active lease, then reports every
15 seconds. Pending reports retain identical JSON and sequence across retries.
UTC midnight reports include yesterday and today. Accepted UDP packet frames
count streaming time; connected WebRTC and PCM listeners contribute listener
time and estimated bytes at the selected bitrate/PCM format. No project,
invitation, passcode or audio content is reported.

Pause, stop, End, detach, lease expiry and sign-out release the account lease.
Signed-in starts require server approval; server plan/listener limits apply.
Revocation/409 blocks account streaming and offers explicit reconnect. Network
outages retry and stop account streaming before the 45-second lease expires.
Anonymous Free streaming remains available with three listeners. Automated
Node test workers do not restore or rotate the user's real Keychain login.

## Verification

- 124 Node tests passed, including SQLite database tests and mocked account
  client retries, 401 renewal, UTC rollover, pause/resume, limits and revocation.
- macOS arm64 VST3, AU and standalone built, bundled, signed and locally installed.
  Previous user-plugin bundles were backed up by the existing install script.
- Live Clerk sign-in and version-1 enrollment verified from the 1.0 app; dashboard
  displayed this Mac as SessionStream 1.0 with the server's Free/3-listener plan.
- Earlier shared-client live test (before moving into 1.0) sent native generated
  audio to a local listener and added 12 MB to the real dashboard. Dashboard
  Disconnect caused a 403 and stopped the helper; explicit reconnect succeeded.
- The standalone 1.0 app's default muted/no-device state produced no UDP packets:
  UI liveness alone correctly contributed no streaming usage.

This is a local test build, not a published installer. Physical DAW testing,
Windows Credential Manager/runtime verification and a multi-computer live
session-limit check remain necessary before release. Synthetic/mocked tests
are not physical-DAW verification.
