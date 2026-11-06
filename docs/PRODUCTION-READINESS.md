# Production readiness review — 2026-11-04

## Implemented in this pass

- Dashboard document entry re-enters Clerk OAuth; account data always revalidates the provider identity. ClerkJS obtains a fresh browser session token rather than trusting a cached logged-in UI.
- If CLERK_SECRET_KEY is configured, browser account data and mutations additionally check the referenced Clerk session's active status and matching user using Clerk's server API. The session ID is a lookup key, not an identity assertion: the verified OAuth identity and server-owned Clerk session record must agree.
- Canonical Clerk Billing reconciliation on dashboard loads; checks cache for at most 60 seconds on plugin reporting. Only Clerk subscriptions grant access. The owner confirmed direct Stripe billing was test-only; direct Stripe integration is removed.
- Checkout uses the account's verified Clerk email; existing customers' email is updated. Upgrade intent survives the sign-in redirect. Existing Pro or recoverable unpaid subscriptions route to billing instead of creating another subscription.
- Welcome-to-Pro view waits for canonical subscription status. No purchase success is inferred solely from URL parameters.
- Pro Local: one sender per installation. Pro Cloud: one sender per account. Free retains one account sender. Cloud relay itself is NOT implemented in the inspected server.
- Mobile account controls use consistent icons and 44px hit targets. DAW badge containers are transparent. Desktop/native host requirement and browser-only DAW exclusion are visible.
- Support contact and user-initiated account/data deletion email request are available. There is no silent background email sender.

## Required before a production release

1. **Clerk configuration:** CLERK_SECRET_KEY is now configured in the Worker. The user disabled the global self-deletion option in Clerk during this setup. Sign-in does not depend on a per-user settings mutation. Never place it in source or chat. In Clerk Dashboard → User & authentication → User model → User permissions, turn OFF “Allow users to delete their accounts.” This global policy cannot be enforced just by removing a website button; the hosted Clerk profile editor otherwise still permits deletion. Enable the OAuth app's email scope and test existing-account reauthorization.
2. **Revocation verification:** with the server key configured, revoke an actual Clerk browser session and confirm reload, direct account API calls, and billing actions fail. OAuth/plugin grants are distinct from browser sessions; separately test revoking a plugin OAuth grant and dashboard installation revocation. Fresh browser token retrieval is not a substitute for the configured server check.
3. **Clerk Billing live verification:** production Clerk Billing is enabled with the $5 USD/month Pro plan. Verify a real authorized purchase, receipt email delivery, payment history, renewal, cancellation and refund handling. The direct Stripe test checkout, portal and webhook are retired. Rotate any key previously shared in chat.
4. **Subscription recovery:** purchases created externally or under a different Clerk account must go through a reviewed support recovery flow. Automatically granting Pro based only on a matching email would be unsafe. Add reconciliation alerts for multiple customers/subscriptions and failed webhooks.
5. **Feature delivery:** the inspected implementation has quality presets, reusable links, up to eight listeners and DAW-to-DAW receiving. It does not have cloud audio fan-out, synced DAW timeline recording, or all previously proposed listener moderation controls. Do not advertise those as delivered. Managed Cloudflare links still carry audio from the producer's computer; they are not a hosted audio relay.
6. **Native release:** the plugin integration has been modified by another ongoing project since the original prototype. Run the complete account flow in the installed macOS and Windows plugins, including the new mode policy. Rebuild, sign and publish correct installers; current public downloads point to release 0.30. Test real DAWs rather than equating host-format compatibility with tested product support.
7. **Deletion operations:** publish a clear support procedure for verifying a request, resolving/cancelling billing with user consent, deleting Clerk identity, account records, old migration records and provider tokens, and handling required billing record retention. Until the Clerk policy is disabled, the request-only flow is not fully enforced.
8. **Operations:** verify support@sessionstream.app actually receives and sends mail. Add monitored alerts for Worker exceptions, Stripe webhook failures, Clerk failures, tunnel capacity and storage costs; select a backup/recovery procedure and test a restore. Decide retention and privacy terms before real customer data collection.

## Bounds of this review

Tests establish the specified code paths, account isolation and local Cloudflare runtime behavior. They do not prove real payment settlement, email delivery, Clerk Dashboard settings, all DAW compatibility, independent security review or native production runtime success.
