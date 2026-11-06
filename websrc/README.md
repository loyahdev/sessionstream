# SessionStream product website

The product page is at the repository root. Public scripts, styles and images live in `websrc/`; the account dashboard source is in `websrc/dashboard/`. The app's browser listener stays separate in `web/`.

`npm run build:site` creates the allowlisted `site-dist/` deployment. The existing Cloudflare tunnel Worker serves the website, protects account APIs, preserves all listener routes, and hosts the Clerk OAuth/Stripe account service. Follow `docs/WEBSITE-ACCOUNTS-STRIPE.md` to configure the Clerk callback and Stripe secrets.
