# SessionStream account database and plugin API

## Production storage

- Clerk remains the identity provider. Passwords are never stored by SessionStream.
- Clerk Billing is the subscription authority for new subscriptions. Server-side Clerk subscription lookups update the short-lived billing cache; a client cannot choose its own plan. Direct Stripe test billing has been retired; only Clerk subscriptions grant Pro.
- `AccountHub` keeps the existing private OAuth sessions and historical test billing records. Session cookies are opaque, Secure, HttpOnly, SameSite=Lax, and stored by hash. Provider tokens stay server-side.
- `ACCOUNT_STATE` / `AccountState` is a SQLite-backed Durable Object **per verified Clerk user** (`account:<Clerk user ID>`). The database is reachable only through the Worker binding, never a public SQL endpoint.
- The dashboard's existing `GET /api/account` reads that account's database. No separate dashboard database or browser-side credentials are needed.

## Schema (version 1)

| Table | Purpose |
|---|---|
| account | Verified Clerk ID, current name/email/photo, import marker |
| devices | Installation ID, display name/platform/version, hashed credential, revocation and last-seen timestamps |
| daily_usage | UTC date, streaming seconds, combined listener seconds, estimated audio bytes |
| runs | Per-installation run, latest sequence number, report digest and receive time |
| counters | Cumulative counters per installation/run/UTC date |
| active_session | One active sender lease per account, expiring after 45 seconds |
| audit | Enrollment, revocation and import events; no tokens/audio |

All SQL values use bound parameters. Device and usage mutations run in SQLite transactions and are serialized **within each account**, not across every customer.

## Existing-data migration

On the first authenticated request, the gateway copies the user's legacy devices and daily totals into the new private database. SQL imports and gateway markers make retries idempotent. Original legacy records are retained, not deleted. Existing cookies, Clerk configuration, Stripe mappings and tunnel bindings are preserved. Imported devices have no new installation credential until enrolled.

## Plugin integration (add to the plugin later)

Base URL: `https://sessionstream.app`.

Use the existing Clerk public OAuth authorization-code + PKCE sign-in. Keep the refresh token and installation credential in macOS Keychain / Windows Credential Manager. Never put a Clerk secret key, Stripe key or Cloudflare token in the plugin.

Every request below requires `Authorization: Bearer <Clerk OAuth access token>` and JSON content. The server verifies that token with Clerk, and derives the account ID itself. Do not send an account ID or plan. Use a stable random UUID for each installation.

### 1. Enroll once

`POST /api/account/plugin/v1/enroll`

```json
{
  "device": "11111111-1111-4111-8111-111111111111",
  "name": "Studio Mac",
  "platform": "macOS",
  "version": "1.0"
}
```

A successful `201` response returns `deviceCredential` **once**, `reportIntervalSeconds: 15`, and `activeLeaseSeconds: 45`. Save the credential in the OS credential store. Only its SHA-256 hash is stored in the database; dashboard responses never include it.

A maximum of three non-revoked installations is allowed. Re-enrolling an already credentialed ID returns `409`. A revoked ID cannot be resurrected using an old token. After an explicit reconnect/reinstall, generate a new installation ID and enroll after sign-in; remove unused computers in the dashboard if necessary.

### 2. Report usage and liveness

`POST /api/account/plugin/v1/report`

```json
{
  "device": "11111111-1111-4111-8111-111111111111",
  "deviceCredential": "<saved installation credential>",
  "run": "<32 lowercase hex characters generated at process start>",
  "sequence": 1,
  "live": true,
  "version": "1.0",
  "totals": [
    {"date": "2026-11-03", "seconds": 15, "listenerSeconds": 30, "bytes": 1912500}
  ]
}
```

- Send an initial zero-counter report, then approximately every 15 seconds while signed in. `live: true` acquires/renews the one-sender lease; `live: false` releases it. Send a final report when stopping, and never depend on a final report arriving after a crash.
- Increment `sequence` for every new report in a run. Retry an identical failed request with the **same sequence and payload**. A replay is acknowledged without adding usage or renewing liveness. Reusing a sequence with changed data returns `409`.
- Counters are cumulative **per run and UTC date**, not per request. A new process/run starts from zero. Keep today's and, around midnight, yesterday's totals in the same report (maximum two dates). Never decrease a day's counters within a run.
- Streaming seconds count time actually sending audio. Listener seconds add the time of every connected listener. Two people listening for 15 seconds contribute 30 listener seconds.
- Bytes may initially be estimated from the actual stream bitrate times listener count; the dashboard labels them as estimates. Audio content, DAW projects, invite links, passwords, listener identities and IP addresses are not part of this reporting contract.
- The receiver bounds accepted deltas to at most 60 seconds of server-observed elapsed time, plan listener capacity and a byte-rate ceiling. This limits malformed/forged reports. It intentionally does not provide unbounded offline backfill. Long offline gaps can undercount usage; do not use these client-reported metrics for financial billing.
- `403`: installation disconnected/invalid credential; stop account reporting and ask the user to reconnect. `409`: device/session limit, sequence conflict or counter reset. `401`: renew the Clerk token or sign in again. `429`/`503`: retry with backoff; retain the exact pending payload.
- Plugin responses include the server-derived plan and listener limit. A client-reported plan is never accepted.

The old unversioned `/api/account/plugin` returns `426` in production. The earlier `server/dashboard-client.mjs` prototype must be upgraded to this contract before building a plugin release. This change does not rebuild or publish installers.

## Retention and recovery

Daily totals are retained for 365 UTC dates; report cursors/counters for roughly two days; operational audit events for 30 days. Scheduled cleanup is not postponed by heartbeats. Legacy migration source records remain in AccountHub. The dashboard currently displays a 30-day window.

Inspect private storage in Cloudflare's Durable Objects tools. Use the platform's SQLite Durable Object point-in-time recovery for operational recovery, following the Cloudflare account's plan and retention limits. Do not expose an admin/debug data endpoint publicly, or export provider tokens into diagnostic logs.

## Verification and boundaries

`npm test` includes real SQLite tests for persistence, owner isolation, hashed credential handling, device/session limits, revocation, duplicate reports, malformed input, retention, migration retries and the authenticated dashboard-to-database path. A separate local Wrangler runtime smoke test checks the actual Durable Object SQLite implementation.

This is a tested security design, not a guarantee that a system can never have vulnerabilities. Plugin reports remain client-supplied usage estimates. Actual installed-plugin reporting, live payment processing and DAW-specific compatibility require their respective runtime verification.

## Session policy update — 2026-11-04

Reports may send `mode: "local"` (default for existing clients) or `mode: "cloud"`.
Pro Local permits one active run per enrolled device; Pro Cloud permits one active run per account. Free keeps one active run per account and cannot use Cloud mode. Cloud mode here defines admission policy only; an audio relay must be implemented and tested before that delivery option is released. `activeSessions` in the dashboard response lists active leases. Native clients should explicitly send their real delivery mode and must not label managed tunnels as cloud fan-out.
