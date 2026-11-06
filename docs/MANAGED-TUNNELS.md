# Managed SessionStream tunnels

The plugin helper tries `https://sessionstream.app/v1/leases` first. A successful
lease assigns a dedicated remotely managed Cloudflare Tunnel and an internal
`t-<uuid>.sessionstream.app` DNS record. Listeners see only a random six-digit
URL, for example `https://sessionstream.app/004217`.

There are no user accounts, claimed links, or permanent names in this version.
The six-digit code is a bearer invite. Anyone who has or guesses an active code
can open its listener page; enable the existing session passcode when access
needs to be restricted. Passcodes remain enforced by the local listener.

## Owner setup

1. Register/add `sessionstream.app` in your Cloudflare account and wait for its
   zone status to become Active.
2. In `services/tunnel-broker/wrangler.jsonc`, set `CF_ACCOUNT_ID` and
   `CF_ZONE_ID` to that account and zone. The included configuration takes over
   the apex `sessionstream.app` as a Worker custom domain. Check for an existing
   website before deploying to a domain already in use.
3. Create a **dedicated Cloudflare API token**, limited to this account and zone:
   - Account: **Cloudflare Tunnel: Edit** (the dashboard may label this
     Cloudflare One Connector: cloudflared Write).
   - Zone: **DNS: Edit**, for `sessionstream.app` only.
   Do not put an account API token in the desktop application or source code.
4. From the repository, deploy the Worker and securely enter its token:

   ```sh
   npx wrangler deploy --config services/tunnel-broker/wrangler.jsonc
   npx wrangler secret put CF_API_TOKEN --config services/tunnel-broker/wrangler.jsonc
   ```

   The second command prompts for the token without placing it in the command
   line. Keep `CF_API_TOKEN` as a Worker secret. The saved Wrangler OAuth login
   can deploy Workers but does not replace the broker's dedicated DNS/tunnel token.
5. Run a new helper/build and generate an invite. Verify the six-digit HTTPS
   link on another device, both WebRTC and Buffered audio, the optional passcode,
   and generation of a new code. Rebuild and distribute the plugin installers
   to deliver these source changes to installed copies.

## Lifecycle and fallback

- Each helper receives only its own tunnel connector token and a separate
  random lease capability. Connector tokens travel in the cloudflared child
  environment, rather than command arguments or files.
- Only `http://127.0.0.1:<listener-port>` is configured as an origin. The local
  studio, controls, and raw plugin UDP are never tunneled.
- Quick Tunnels retain fresh-DNS and consecutive health checks. Managed links wait
  for a registered connector, then verify the current instance through the same
  stable-origin HTTPS route a browser opens. No invite is advertised before that succeeds.
- A changed invite rotates the code on the existing tunnel. The listener rejects
  the old code immediately, including during renewal; the new URL is advertised
  after it passes health checks. Codes are temporary and may eventually be reused.
- The helper renews every minute. Unrenewed leases expire after five minutes;
  a Durable Object alarm attempts DNS/connection/tunnel deletion every minute.
  Cleanup failures keep their records for retry and continue counting against
  capacity. Expired codes stop routing even if deletion is delayed.
- Provisioning failures, capacity/rate limits, connector exits, failed renewals,
  and failed health checks switch that helper to TryCloudflare. The next helper
  startup tries managed service again. A fallback URL uses the existing
  `/listen#<private-invite>` format and must be shared again.
- Five unassigned tunnels and their DNS records stay pre-created on the account,
  replenished every minute by the Worker schedule and Durable Object alarm. New
  spares age for 45 seconds before allocation so route propagation happens before
  a session needs them. Allocated tunnels are deleted on release, not recycled,
  so a previous installation never retains credentials for the next customer.
  `WARM_POOL_SIZE` controls the reserve. A depleted pool falls back quickly to
  TryCloudflare while maintenance replenishes it.
- The default capacity is 900 tunnels including reserves, leaving room within Cloudflare's
  1,000 included tunnels for other uses. Account-wide limits still apply.
- Allocation is limited to 20 leases per IP per hour (configurable with `ALLOCATIONS_PER_HOUR`). Listener routes have
  an approximate Cloudflare rate limit of 120 requests per IP per minute per
  location. These are basic controls for an anonymous service, not user identity
  or a distributed-abuse defense. Monitor the account before broad distribution.
- The Worker/Durable Object is additional infrastructure with its own quotas and
  potential usage costs; the tunnel allowance is not a free unlimited Worker plan.
- Do not cache session paths. The Worker forwards WebSocket upgrades directly,
  rejects foreign browser Origins, and strips cookies/authorization before
  forwarding to the tunnel. The listener serves all assets and audio worklets
  under the code prefix. Existing root paths still work for Quick Tunnels/local use.

For development, `SESSIONSTREAM_TUNNEL_BROKER=off` keeps Quick Tunnels exclusively.
An alternate broker origin may be set with `SESSIONSTREAM_TUNNEL_BROKER`; HTTPS
is required except for loopback test servers. `npm run start:tunnel` remains the
standalone Quick Tunnel development command. The plugin uses `scripts/companion.mjs`.

## Verification

`npm test` includes broker API mocks, lease expiry/capacity/rate/cleanup tests,
code replacement and socket tests against a real local listener, a real helper
process failing over to a fake Quick Tunnel process, and existing protected
invite/lifecycle/audio regressions. These do not prove Cloudflare propagation,
physical DAW behavior, or actual audio on remote devices. Deployment validation
must be recorded separately after the account token is configured.

Cloudflare references:
- https://developers.cloudflare.com/tunnel/features/tunnels-for-platforms/
- https://developers.cloudflare.com/tunnel/get-started/
- https://developers.cloudflare.com/tunnel/reference/tunnel-tokens/
- https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/


## Live validation on October 29, 2026

The deployed service was tested against the owner's active Cloudflare zone:
protected code-only links rendered separate left/right audio in Chrome over both
WebRTC and Buffered PCM, replacing an invite invalidated its old code, and lease
release removed its DNS/tunnel resources. A rebuilt VST3 was then loaded in the
native test host: its bundled helper provisioned a managed link automatically,
received native audio, and shut down/expired the link when the plugin was removed.
The account ended with zero temporary managed test tunnels and its five existing
tunnels preserved. VST3 and AU were installed locally with previous copies retained.
These checks do not claim actual Ableton UI or physical Windows DAW testing.

Run the opt-in live test with `node --expose-gc tests/managed-tunnel-live.mjs` after
configuring the owner's service and installing cloudflared. It creates temporary
account resources and a synthetic tone, then cleans them up. Results are written
to the system temporary directory. The saved combined report for this run is
`artifacts/managed-tunnels-validation.json`.


## Startup fix validation

The observed user log connected the tunnel in about 0.4 seconds but spent another
32.8 seconds waiting for its freshly created route. The plugin also waited for a
placeholder public link before allowing an invite request. Create/Start now become
available when the local helper is ready. Opening the editor starts no tunnel;
network provisioning begins only after an invite or Start request. Generation is
acknowledged locally while that requested network preparation continues. Pending protected requests still take priority
over automatic starts; URLs remain hidden until their instance health check passes.

Two new helper/controller processes, each assigned a separate pre-created tunnel,
measured local controls at 0.546/0.576 seconds, first valid links at 4.088/3.615
seconds, and replacement links at 0.922/1.137 seconds. Both first links passed
instance health and protected Chrome socket authentication. This is measured on
this Mac and network; the reserve avoids per-session route creation but does not
guarantee those times on every network. All 51 server tests and native delayed
readiness, queued protected Start, lost acknowledgement, engine-restart and bypass
recovery checks passed. The five ready spares are intentionally retained on the
account; test leases are removed. See `artifacts/managed-tunnels-startup-validation.json`.

The final on-demand version was timed again: local controls at 0.558 seconds,
first working link at 4.105 seconds, and replacement link at 1.140 seconds, with
a protected Chrome listener authenticated. The idle-helper regression also proves
that no cloudflared process starts until the first invite request.
