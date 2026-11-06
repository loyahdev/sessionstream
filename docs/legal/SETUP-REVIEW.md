# Legal-page setup review

Terms and Privacy approved for publication by the operator on November 4, 2026, with focused clarifications. Public pages are /terms/ and /privacy/. This is an implementation note, not a certification of legal compliance.

Confirmed by the operator:
- Individual operator: Jaxon Hensch, Alberta, Canada; no company name invented.
- Account/Pro eligibility: age of majority where the user lives.
- Refunds possible at the operator's discretion; no guaranteed refund window; applicable consumer rights preserved.

Operational follow-up:
- Continue to confirm the operational promises can be honoured, especially cancellation, refund handling, access/correction requests, deletion, security incidents and retention of older migration copies.
- Confirm the support mailbox is functioning. Do not publish a home address inadvertently; determine whether any particular sales market requires additional supplier disclosures.
- Align the downloadable software's existing licence with the intended product terms. The current source repository has licensing declarations that should be separately reviewed; the service Terms avoid claiming to override the licence delivered with software.
- Check live Stripe portal cancellation timing and invoice/price/tax disclosures. The present public integration is in test mode.

Publication and integration:
- Done: package HTML at /terms/ and /privacy/, shared stylesheet, effective dates, sitemap entries, and homepage/dashboard footer links.
- Set the legal URLs and required legal consent in Clerk's sign-up configuration. Record the accepted version where appropriate, and give existing users appropriate notice rather than asserting retroactive assent.
- Set the terms/privacy URLs in Stripe's public business details. Enable required checkout terms consent only once the hosted legal URL is configured; test checkout before switching live keys.
- Put the relevant links in the installer/plugin account flows and make any required age attestation reflect the stated eligibility rule.

Sources checked November 4, 2026:
- Alberta privacy responsibilities: https://www.alberta.ca/organization-responsibilities-for-protecting-personal-information
- Alberta PIPA scope includes individuals acting commercially: https://oipc.ab.ca/legislation/pipa/
- Alberta consumer rights: https://www.alberta.ca/consumer-bill-of-rights
- Canadian meaningful consent: https://www.priv.gc.ca/en/privacy-topics/privacy-for-businesses/appropriate-handling-of-personal-information/collecting-personal-information-and-consent/consent/gl_omc_201805/
- Cross-border processing: https://www.priv.gc.ca/en/privacy-topics/airports-and-borders/gl_dab_090127/
- Provider policies: https://clerk.com/legal/privacy ; https://www.cloudflare.com/privacypolicy/ ; https://stripe.com/privacy

Published pages describe the inspected implementation, including Google-hosted fonts, rather than assuming a future cloud audio relay or claiming all data stays in Canada. Recheck them when the product or providers change.
