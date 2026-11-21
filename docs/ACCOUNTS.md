# Optional plugin accounts

SessionStream uses a Clerk **public OAuth client** with Authorization Code and S256 PKCE. The hosted Clerk Account Portal handles sign-in and consent. No website account page or Clerk secret key is required. Streaming, random links, and listeners work without signing in.

## Clerk setup

Create the SessionStream Clerk application, enable its Account Portal, then create an OAuth application with:

- Public client; require PKCE.
- Scopes: `profile offline_access` (offline access allows remembered login).
- Exact redirect URI: `http://127.0.0.1:8788/auth/callback`.
- Production domain DNS records supplied by Clerk, with Cloudflare proxy disabled for those records.

The public issuer and Client ID are in `server/account-config.json`. Development overrides are `SESSIONSTREAM_CLERK_ISSUER` and `SESSIONSTREAM_CLERK_CLIENT_ID`. These contain no secret. Rebundle the runtime after changing the bundled configuration. If using a different studio port for development, register that exact callback URI in Clerk too.

## Current behavior

The plugin's header Sign in control opens the browser. A successful callback displays Welcome and the first name or profile name. Click the greeting for Sign out; a pending login can be cancelled. Existing streaming is unaffected by sign-in or sign-out.

Refresh tokens are saved in macOS Keychain or Windows Credential Manager through the bundled native `account-credentials` helper. They never enter plugin project state, cache files, command arguments, logs, or diagnostics. The helper restores the account from Clerk on startup and renews access automatically. Token rotation is saved before fetching the user profile, so a temporary profile outage cannot strand an obsolete refresh token. Temporary network failures retain saved login and retry; revoked grants require sign-in again. Sign-out clears saved credentials. No paid features or reserved links are enabled.

The callback is accepted only on the local studio listener, uses an expiring random state, and consumes each transaction once. Tokens are exchanged by the helper, never returned to the browser or plugin UI. Identity comes from Clerk's HTTPS user-info endpoint, not an unverified JWT. Sign-out invalidates in-flight callbacks and clears local identity and secure storage; it does not sign the browser out of Clerk. OAuth errors and credentials are not logged.

## Validation

`node --test tests/account.test.mjs` checks PKCE, profile retrieval, state rejection, expiry, cancellation, replay, helper restart restoration, refresh rotation, outages, revoked grants, and sign-out races. The native helper can be checked separately with `node tests/account-credentials.mjs` after building; it uses a disposable credential and removes it afterwards. Real Clerk sign-in additionally requires working production DNS and the configured public client.


## Custom share links

Each Clerk account can reserve one name. Names are case-insensitive, 3–32 characters, begin with a letter, and contain letters, numbers, or dashes. System paths are reserved. A successful rename atomically releases the old name; a collision leaves the existing claim unchanged. Selecting Random keeps the saved name reserved. Release custom link is available from the account menu.

Custom links reuse the existing account sign-in. The helper exchanges its memory-only, short-lived access grant with the SessionStream broker, which verifies identity directly through Clerk user-info and issues a separate opaque credential limited to link management and tunnel binding. Refresh tokens remain in the OS credential store and are never sent to the broker. The scoped credential is saved in the OS credential store, expires after 30 days, and can be renewed using the existing login without opening another browser sign-in. A credential-store write failure does not reject an already verified session. Claims are stored durably on the broker and do not expire when a stream ends or a plugin is removed. Legacy PKCE callbacks remain supported for older installed clients. At the Cloudflare edge, authentication fetches use manual redirects and reject non-success responses; redirect error mode is not supported by Workers.

The broker serializes claim changes and resolves routes from a transactional snapshot. Both ownership indexes and the active lease must match, preventing an old session from routing through a released or reassigned name. Only one active session per account can bind the custom name. Random sessions remain available without an account.

## Receive mode

Choose Receive, enter the six digits or custom name after `sessionstream.app/`, and Connect. Full SessionStream links and fallback TryCloudflare invites are also supported. Enter the host's passcode if required. The plugin replaces its track input with the received stereo audio; disconnected/underrun output is silent. Receive mode and custom-link controls are shown only while signed in. Signed-out users keep the compact random-link sender. The local receive API also requires a signed-in account to start a receiver.

The companion receives the existing buffered PCM WebSocket stream and forwards bounded packets over loopback UDP to that plugin instance. A native SPSC FIFO performs sample-rate conversion to the receiving DAW on the audio thread without allocation, locks, or networking. Queues remain bounded, reconnects refetch the current invite, and explicit detach/removal stops that instance's receiver. Offline rendering outputs silence in Receive mode. The selected mode is saved with the DAW project, but connecting remains explicit; links, passcodes, and account credentials are not saved in project state.
