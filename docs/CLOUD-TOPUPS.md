# One-time Cloud top-ups

Pro subscriptions continue through Clerk. Top-ups use Stripe Checkout in payment mode: USD $5 buys 300 listener-hours. An active Pro subscription is required for Cloud streaming and top-up checkout. Free accounts retain unused credits but cannot spend them until Pro is active again. There is no separate subscription and no Pro entitlement from a purchase. Test purchases grant Cloud usage only, just like paid top-ups.

## Connect Stripe

Keep live and sandbox configuration side by side. No key swapping is needed.

| Environment | API secret | Webhook signing secret | Webhook path |
| --- | --- | --- | --- |
| Live | `STRIPE_TOPUP_SECRET_KEY` | `STRIPE_TOPUP_WEBHOOK_SECRET` | `/api/account/cloud-topup-webhook` |
| Sandbox | `STRIPE_TOPUP_TEST_SECRET_KEY` | `STRIPE_TOPUP_TEST_WEBHOOK_SECRET` | `/api/account/cloud-topup-test-webhook` |

1. Create each webhook in its matching Stripe environment at `https://sessionstream.app` plus the path above. Choose **Your account**, **Snapshot** payloads, and events `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
2. Add the secrets to the `sessionstream-tunnels` Worker. API keys must match their environment (`sk_live_`/`rk_live_` or `sk_test_`/`rk_test_`). Configure payment methods in Stripe Dashboard. The backend defines the fixed product and price.
3. To enable sandbox billing on the normal purchase button, merge `sessionstream.billingTester: true` into the tester's Clerk **Private metadata**. Public and unsafe metadata cannot grant test access.
4. Sign in and use **Add 300 hours · $5**. The dashboard marks tester accounts with **Sandbox billing**. Confirm Stripe shows Test mode before entering a test card. Only the sandbox webhook can credit sandbox receipts. Sandbox credits appear in the normal Cloud balance and fund real Cloud playback while the account has the trusted billingTester flag. They remain in a separate ledger. Removing tester access excludes unspent test credit; paid credit is preserved. Included monthly hours are used first, then tester credit, then paid credit.
5. Ordinary accounts use live checkout. Tester accounts use sandbox checkout automatically, with no fallback to a live payment if sandbox configuration is missing. Live keys remain unchanged while testing.

The API requests are pinned to Stripe `2026-11-18.endive`; the webhook reads only the event type and Checkout session ID, then re-fetches canonical payment details.

The buy button appears only after both secrets for the account’s billing environment are configured. `npx wrangler secret put STRIPE_TOPUP_SECRET_KEY --config services/tunnel-broker/wrangler.jsonc` and the same command for `STRIPE_TOPUP_WEBHOOK_SECRET` prompt privately for values. Never paste secrets into chat or command arguments.

## Crediting and usage

The backend verifies the raw webhook signature with a five-minute tolerance, fetches the canonical Stripe session, and checks payment status, authenticated account reference, payment mode, amount, currency, quantity and non-recurring price. The browser return URL cannot grant credit. A per-account transaction records the Checkout session ID with the credit, so webhook redeliveries and different event IDs cannot grant the same purchase twice.

Monthly included hours are used first. Purchased hours carry over across billing months. The dashboard confirms a top-up using the authenticated account's receipt ledger, rather than trusting the return URL. Existing admin monthly overrides remain separate from purchased credits.

Refund/dispute handling and any refund policy need an operational decision before selling publicly. This flow does not automatically revoke previously consumed hours after a refund.

Clerk stores `sessionstream.cloudMonthlyRenewHours` as the refill setting. `cloudNormalHoursRemaining` shows the calculated included balance. `cloudTopupHoursRemaining` shows carried-over credit and accepts per-account administrator edits without changing included hours. The dashboard adds the buckets for its total. The obsolete `cloudHoursRemaining` metadata field is removed automatically; editing it never changes a balance. See CLOUD-SETUP.md for the accounting rules.
