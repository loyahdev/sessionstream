# SessionStream Cloud setup — 1.0.3

Cloud audio is integrated with the native companion, browser listener and DAW Receive. The media relay is Cloudflare Realtime SFU. Authentication, per-installation credentials, quota checks and receipts stay in the existing account backend.

## Cloudflare configuration

On the `sessionstream-tunnels` Worker, keep these values server-side:

- `REALTIME_SFU_APP_ID`: the Realtime SFU application ID.
- `REALTIME_SFU_BEARER_TOKEN`: the SFU application's secret.
- `CLERK_SECRET_KEY`: the existing Clerk backend key.
- `CLERK_PRO_PLAN_ID`: the configured Pro plan.

Keep credentials in encrypted Secrets. Never put them in plugin assets, client JavaScript or Git. Deploy with `--keep-vars` so dashboard-managed configuration survives a source deployment.

Official provider setup: https://developers.cloudflare.com/realtime/sfu/get-started/

## Plans and listener limits

| | Free | Pro |
| --- | --- | --- |
| Monthly included hours | None | 300 by default |
| Direct listeners | 3 | 8 |
| Cloud listeners | Unavailable | Metered by listener-hours; no count cap |
| Cloud access | Unavailable, including accounts with stored credit | Included allowance and top-up credit |
| Sender formats | Opus 320 kbps stereo | Opus 96–510 kbps mono/stereo; PCM 16/24/32-bit float, mono/stereo/5.1/7.1 |
| Receive, reusable links, approval and feedback | Unavailable | Available |

A Free account with stored credit cannot host Cloud or purchase more top-ups. Credits are retained for Pro reactivation. Legacy monthly metadata cannot grant Free accounts Cloud access or included hours. A Pro downgrade removes included hours, preserves carried-over credit, and closes Cloud media through the existing entitlement-expiry checks. Registered and currently authorized installations are required to host Cloud sessions.

## Clerk private metadata

In Clerk, open **Users → account → Private metadata**. Merge into `sessionstream` without replacing unrelated keys:

```json
{
  "sessionstream": {
    "cloudMonthlyRenewHours": 300,
    "cloudTopupHoursRemaining": 500,
    "cloudNormalHoursRemaining": 200,
    "billingTester": true
  }
}
```

- `cloudMonthlyRenewHours`: editable Pro monthly refill amount. Defaults to 300. It does not give Free accounts a monthly allowance.
- `cloudTopupHoursRemaining`: editable carried-over balance. Use a non-negative JSON number. A dashboard refresh applies a saved edit immediately; active plugin reporting checks within 15 seconds. This changes only carried-over credit, never normal included hours or payment receipts. Administrator increases are tracked separately from paid and sandbox purchases.
- `cloudNormalHoursRemaining`: calculated included hours left in the current billing month. Do not edit this readout.
- `billingTester`: a strict boolean. Authorized Pro testers use Stripe sandbox checkout from the normal purchase button and can spend their test credits through Cloud only with active Pro. Removing the flag excludes remaining sandbox credit but preserves paid/admin credit and never grants Pro features.

The dashboard calculates the total from the buckets. The obsolete `cloudHoursRemaining` field is deleted automatically and cannot reset balances. `cloudMonthlyHours` is a legacy Pro refill fallback only; prefer the new refill field.

## Renewal and consumption

Included hours are consumed first, then administrator credit, authorized sandbox credit and paid top-ups. Top-up credit does not expire at renewal. Only included hours refill; they do not accumulate.

Example: 200 included + 300 top-up = 500 remaining. At renewal, that becomes 300 included + 300 top-up = 600.

Monthly subscribers follow Clerk's verified billing period. Annual subscribers receive monthly refills on their billing anniversary; end-of-month dates are clamped without drifting. Idle renewal work is scheduled at the boundary. The backend does not invent a paid renewal from elapsed time when Clerk has not confirmed it.

Storage transactions preserve usage cursors and purchase receipts. Invalid requests and retried webhooks cannot charge the same interval or credit the same purchase twice. Metadata outages retain the metering ledger and retry synchronization.

## Audio privacy and lifecycle

Cloud sends a single encoded stereo stream from the host to the SFU. Listener endpoints obtain AES-256-GCM keys through admitted direct DTLS DataChannels; audio keys are excluded from broker requests and SFU credentials are never sent to clients. Membership removal rotates the Cloud key. The default extra encryption can be disabled before creating an invite; HTTPS/WebRTC transport protection remains enabled.

Pause closes Cloud media allocations and metering; resume creates fresh allocations and keys while preserving the invite. Expired leases, quota exhaustion and ended sessions close the publication. Allocation time is metered, including listeners that omit their ready acknowledgment.

See `CLOUD-TOPUPS.md` for Stripe setup and refund handling. Automated/native-runtime checks are documented in the release validation; fresh-machine installations, native Windows DAW execution and large real classrooms remain distinct validation steps.
