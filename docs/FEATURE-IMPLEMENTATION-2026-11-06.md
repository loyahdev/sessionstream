# SessionStream 1.0 — local feature implementation

## Scope and website comparison

| Website feature | Current implementation |
|---|---|
| High-quality stereo from your computer | Existing native sender retained; Free Studio stereo remains available |
| Browser listening, Live and Buffered audio | Existing paths retained; approval now gates both transports and signaling |
| Free without an account | Retained with the server's Free listener capacity |
| Password-protected temporary links | Retained, checked before admission requests |
| 3 Free / 8 Pro listeners | Uses the server-returned listener capacity; host approval cannot exceed it |
| Studio / Balanced / Phone presets | Existing presets now visibly gated to Pro for the optional presets |
| Reusable custom links | Existing reservation and authorization retained; Pro gating is explicit in plugin and backend |
| Account, billing and usage | Existing Clerk login retained; plugin shows Free/Pro and links to dashboard/subscription |
| Approve / reject / revoke listeners | New Pro host-only inline Listeners tab and waiting room |
| Guest vs signed-in listeners | New optional setting; verified account proofs are room-bound, single-use and expire after 90 seconds |
| Common branding | Website wave-mark SVG, DM Sans UI text and Manrope wordmark/headings are bundled locally |
| Cloud streaming / synced DAW audio | Excluded from this work; existing Receive implementation was preserved |

The settings can be selected before creating an invite by an attached controller. They remain in memory for that controller's helper session. Accepted browser credentials reconnect without asking again. Revoked and rejected credentials stay denied for the current invitation. Revoking access also enables approval for future guest requests. A guest can request again from a different browser, but receives no audio until accepted; use signed-in-only mode to bind revocation across browsers to a verified account. Starting a new invitation clears admission records. No IP address bans or permanent account bans are claimed.

## Security and privacy

Host changes require the local control credential, matching Origin and owning plugin source. Pending listeners receive no ICE, offers or PCM audio. Both transport paths share admission. Reconnecting a browser/account replaces its previous connection so revocation cannot leave a hidden second audio connection. Pending requests expire; the in-memory roster is bounded. Account proofs use the existing verified web session and host's existing Clerk OAuth token. No service secret is embedded in the plugin. Listener names/identities are not included in account usage reporting or diagnostics.

## Validation and rollout

- Native editor: visually tested Accept, Reject, Revoke and account-only toggle in an isolated Pro preview with synthetic accounts and local audio.
- Browser: actual browser waiting state, acceptance, playback state, revocation and denied reconnect verified against an isolated local helper.
- Final full Node suite: 159 passed, 0 failed. Automated tests cover audio isolation, Pro and owner checks, reconnect replacement, room reset, bounds, expiry, identity proof replay and origin checks.
- macOS VST3, AU and standalone compiled locally; VST3 and AU were ad-hoc signed, signature-verified and installed in the user plugin folders with previous versions backed up. The final native editor and browser branding were visually checked. Installed DAW execution remains unverified. Branding uses bundled fonts and the website's exact SVG; no installed system font or external font download is required at runtime.
- Signed-in-only verification endpoints are implemented and tested locally in the Worker source, but are not deployed to production in this pass. Until deployed, that option fails closed. Guest approval/rejection/revocation work in the local helper.
- Windows runtime and physical DAWs require verification for this feature pass.
- No installers or public releases are created or updated for this pass, at the user's request.
