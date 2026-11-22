# Editing the SessionStream website

Working folder: `/Users/jaxonhensch/Documents/GitHub/sessionstream`.

- `index.html`: homepage sections, copy, pricing markup and social metadata.
- `websrc/home.css`: homepage layout, typography and responsive rules.
- `websrc/colors.css`: shared palette and semantic color roles.
- `websrc/assets/`: product captures, photos, fonts and the social preview.
- `websrc/auth/` and `web/account.css`: sign-in, sign-up and shared account layout.
- `websrc/billing/`: checkout, payment confirmation and price verification.
- `websrc/dashboard/`: account dashboard and Pro welcome page.
- `scripts/package-site.mjs`: explicit public asset list and build process.

Edit source files, then rebuild. `site-dist/` is generated and is replaced by each build.

```sh
cd /Users/jaxonhensch/Documents/GitHub/sessionstream
node scripts/package-site.mjs
python3 -m http.server 4190 --bind 127.0.0.1 --directory site-dist
```

Open `http://127.0.0.1:4190/` for a static layout preview. Real account and payment flows use the hosted Clerk/Cloudflare setup; a static preview does not simulate an authenticated account.

To publish with your existing Cloudflare login:

```sh
npx wrangler deploy --config services/tunnel-broker/wrangler.jsonc
```

New public assets must be added to the build allowlist. Account runtime files, credentials, internal notes and installer payloads are not website assets.

Pro is advertised at $10 USD monthly or $100 USD annually. Clerk charges $99.96 USD annually; checkout shows that exact charge and renewal amount. The selected period is preserved through sign-in; checkout verifies the provider's period, plan, USD currency and exact amount. The matching Clerk plan must retain those prices. Cloud copy describes the intended launch offering while its implementation is developed separately.
