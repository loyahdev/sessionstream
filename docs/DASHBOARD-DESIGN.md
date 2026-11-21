# Dashboard redesign — November 20, 2026

## Direction

Carry the public website's Manrope headings, paper/charcoal surfaces, lime actions and violet accents into a working account interface. The main overview uses a dark navigation rail, oversized heading, joined usage readout and flat activity/device sections. One rounded corner on the usage surface echoes the site's architectural silhouette without turning account controls into marketing panels.

The dashboard stylesheet was replaced rather than extending its accumulated small-font and card overrides. Fonts are served from the same local assets as the homepage. Mobile has a horizontally scrollable text navigation and accessible account/theme buttons. Essential text stays readable; forms, device actions and date controls retain practical touch targets.

## Preserved behavior

- Existing Clerk session-token refresh, protected account requests and billing destinations.
- Account totals and daily chart derived from actual API records; week/month selection and daily-detail dialogs.
- Pro-only custom link editing, conflict messages, copy control and dirty-draft protection during refresh.
- Connected-computer list, explicit disconnect confirmation, profile/settings, sign-out and deletion-request actions.
- Loading, failure/retry, empty activity, post-purchase welcome and background refresh states.

The session indicator now distinguishes idle and active sessions. Navigation marks the current anchor. Disconnect dialogs use Cancel for the dismiss action. Unavailable Cloud Relay capacity and its unimplemented data allowance are removed from account entitlements and upgrade benefits.

## Review environment

Visual and interaction checks use a loopback-only server and fictional Free/Pro account fixtures. The fixture substitutes authentication and account responses only on that local server; no authentication bypass or sample account data is packaged or deployed. Screenshots are explicitly marked LOCAL PREVIEW / SAMPLE DATA. No real computer was disconnected, link changed, subscription purchased or account setting changed during these checks.

Account settings in the navigation goes directly to the existing protected settings route; the profile/avatar menu still exposes profile editing and sign-out.

## Verification and deployment status

- Website build, dashboard JavaScript syntax and CSS parsing passed.
- 50 account, billing, dashboard and custom-link tests passed.
- Browser checks at 320, 390, 768, 1100 and 1440px found no page or heading overflow. Light and dark appearances reviewed.
- Local sample-account checks covered Free/Pro, empty activity, active/idle session status, service failure/retry, Pro welcome including refresh, week/month totals, daily-detail dialogs, link-name conflict/draft preservation, successful saving, and the disconnect confirmation with Cancel.
- No observed console errors in the successful account previews. Authentication and payment flows were not executed with a real account.
- After explicit user approval, the dashboard was deployed to Cloudflare. The initial approval rejection was resolved by that confirmation.

Preview screenshots: `wavesstreamvst/artifacts/dashboard-redesign-2026-11-20/`.

## Published deployment

Cloudflare Worker `sessionstream-tunnels`, `https://sessionstream.app`, version `f96e7536-4609-4dc8-90b8-85d63d0dd19c`, serving 100% of traffic. Cloudflare uploaded the three changed dashboard assets. Public dashboard CSS and JavaScript matched the packaged SHA-256 hashes. The homepage still matched its packaged build. Signed-out dashboard requests redirect to sign-in; private account API requests return 401. Styles and JavaScript are public assets, as expected; account data remains protected. No real authenticated account was used to inspect the deployed UI, and no Git commit or push was performed.
