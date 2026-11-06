# SessionStream website and Clerk Billing

The production website, dashboard, account API and checkout run on the existing `sessionstream-tunnels` Cloudflare Worker at https://sessionstream.app. Clerk is the sole subscription authority. Stripe is connected through Clerk only as its payment processor; SessionStream does not create Stripe customers, Checkout sessions, Billing Portal sessions, or read Stripe subscriptions.

## Configuration

- `BILLING_PROVIDER`: `clerk`
- `CLERK_PRO_PLAN_ID`: `cplan_3LfuHOHrgi4rz3CLjd1z9VFXZRR` (`pro_user`)
- Pro: USD $5 monthly, recurring user plan, no annual price or trial.
- `CLERK_SECRET_KEY`: Cloudflare Worker secret, never included in website/plugin files.
- Existing Clerk issuer: `https://clerk.sessionstream.app`.
- Existing public OAuth client: `pc8es4va5qJsFDVW`; retain PKCE, refresh and the website/plugin callbacks.

The account holder confirmed on November 5, 2026 that the old direct Stripe setup was test-only, with no real paying subscribers. It has been retired, including its entitlement fallback. Old test records are left untouched but never grant Pro. The retired Stripe webhook responds with HTTP 410. No payment or cancellation is performed by this code migration.

## Checkout and billing

`/dashboard/billing/` is a branded, responsive checkout with an embedded Clerk PaymentElement and a clear $5 USD/month order summary. The small React island uses the official Clerk 5 components with the same already-loaded Clerk instance; the main site remains buildless. No direct Stripe key or API integration is needed.

The server verifies the public Clerk plan price before allowing checkout. The browser checks the initialized checkout's plan, currency, monthly period and amount. It displays the verified primary email read-only; immediately before confirmation it rechecks the Clerk identity, server account and canonical subscription. Existing Clerk subscribers go to management instead of a second purchase. The submit button is locked while payment is in progress. An ambiguous payment result directs the user to verify Billing instead of retrying a charge.

`/dashboard/account/` embeds Clerk profile/security settings with hash routing, so switching its tabs does not reload the document. A lightweight `/api/account/profile` endpoint verifies OAuth identity and the active Clerk browser session without fetching usage or subscription data; it runs alongside Clerk initialization. The account HTML shows a loading shell immediately, and navigation controls show a pending state before awaiting network work. Full page loads and account actions retain their existing server authentication checks.

`/dashboard/account/billing` opens Clerk subscription management. All dashboard documents and billing actions retain server-side identity and active-session checks. Billing redirects are restricted to the approved same-origin account routes.

Canonical Clerk Backend API subscription lookups determine access. A success URL never grants Pro. Dashboard loads refresh canonical state; plugin/broker checks cache the result for at most 60 seconds. Provider failures return an error instead of silently downgrading a paid account or falling back to another billing system. Clerk account IDs remain the identity for plugin enrollment and aggregate usage.

## Receipts and verification

The owner confirmed that production Clerk payment/receipt templates have **Delivered by Clerk** enabled. Verify an actual receipt through Clerk Email Logs and the recipient inbox after the first authorized purchase. Clerk maintains its own statements and subscription history; do not promise Stripe Billing invoices for Clerk subscriptions. Refund requests are reviewed manually; the actual processor refund action remains an operator task.

Automated checks cover account isolation, subscription status/cancellation expiry, plan pricing, retired Stripe state, hostile redirects, locked account email, and payment failure/confirmation paths. Browser previews validate presentation with sample data. They do not prove live settlement, payment-method acceptance, receipt delivery or native DAW behavior. Do not submit a live purchase without the account holder's authorization.

## Build and deploy

```sh
cd /Users/jaxonhensch/Documents/GitHub/sessionstream
npm ci
npm run test:accounts-web
npm run build:site
npx wrangler deploy --config services/tunnel-broker/wrangler.jsonc
```

The site builder bundles only the checkout island into the public-file allowlist in `site-dist`. It excludes app/plugin source, dependency folders, account data and secrets. Auth pages continue using the existing Clerk sign-in/sign-up components and OAuth completion flow.

See `ACCOUNT-DATABASE.md` for private per-account storage and the versioned plugin API. Website billing changes do not package a new plugin release. Public installers must be rebuilt and tested separately before a new account-enabled release.

Sources: https://clerk.com/docs/guides/billing/overview · https://clerk.com/docs/reference/backend/billing/get-user-billing-subscription · https://clerk.com/docs/guides/development/custom-flows/billing/checkout-new-payment-method
