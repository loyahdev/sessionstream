# Website polish and signup investigation — November 18, 2026

## Delivered

- Rebuilt the marketing homepage around the existing botanical palette, Manrope/DM Sans typography, current plugin screenshots, and a clear studio-to-browser explanation.
- Added an accessible Send / Listen / Receive product explorer with arrow-key navigation, full-size images, subtle pointer tilt, and reduced-motion support.
- Reworked workflow, listening-room, use-case, compatibility, Free/Pro comparison, questions, download, and footer sections. Preserved real account, checkout and download routes. No simulated purchase or invented testimonials.
- Replaced the accumulated 75,789-byte homepage stylesheet with a roughly 29 KB responsive stylesheet. Removed the Three.js hero from the website build; the interactive preview uses CSS and plain JavaScript. Bundled the already-used Manrope and DM Sans fonts locally.
- Updated product images from the rebuilt native preview and current listener source. The images use example session data, identified in the product preview.
- Added dashboard custom-link viewing, claiming/renaming and copying through the existing verified web session. The AccountHub sends only the verified user identity to an internal broker route. The public Worker rejects that internal path. Pro and origin checks apply. Conflicts preserve the original name, and dashboard changes are rejected while the user's custom-link session is active. The plugin's existing rename behavior is preserved.
- Updated the explicit website packaging allowlist for new images and fonts. Rebuilt site-dist.

## Signup finding

The prior policy allowed Clerk's frontend domain and Cloudflare challenge scripts/frames but omitted Clerk Protect hosts. Clerk's current documentation requires *.protect.clerk.com in script/frame sources and *.protect.clerk.com:* in connect sources, plus self/blob workers. These have been added without disabling fraud protections or permitting unsafe-eval.

Source: https://clerk.com/docs/guides/secure/best-practices/csp-headers

Added collapsible account-access help that automatically opens when Clerk presents a validation error or the browser reports a blocked protection resource. The original Clerk error remains visible. Added bounded script/form loading and retry recovery. Help asks for the time and error message, not passwords or verification codes. No visitor email or credential is copied into diagnostics.

The live signup form was inspected without entering an address or creating an account; the initial form loaded with no console error. The reported friend's rejection was not reproduced, and no private Clerk protection settings or application logs were available in this inspection. The CSP problem is a confirmed configuration gap, not proof of the exact cause of that rejection. Deployment and a real retry/log review are still needed to confirm resolution.

## Validation

- 49 account, account-database, existing plugin custom-link, and new dashboard-link/CSP tests passed.
- Native preview initially failed compilation because a UTF-8 hexadecimal escape consumed the following number in Processor.cpp. Split the adjacent C++ string literals and rebuilt invite-editor successfully.
- Existing isolated native editor workflow now passes all 27 stages, including the previously failing guest state and a single scoped credential exchange with no extra browser sign-in.
- Browser inspection covered desktop (1440px), tablet (768px), phone (390px) and narrow phone (320px), light/dark themes, image loading, page overflow, tab keyboard navigation, preview dialog Escape/focus restoration, feature comparison, download failure recovery, dashboard claim/conflict states, and signup help expansion.
- Dashboard and error scenarios used clearly isolated local fixtures. They did not change real accounts, email addresses, subscriptions, or custom links. No payment or successful production signup was tested.

## Scope / release state

The main website and relevant account routes were completed locally in the existing Cloudflare project. No production deployment, Git commit, installer publication, live account changes, fraud-threshold changes, or cloud audio relay was performed. Cloud Relay is consistently identified as Coming soon. Native work was limited to the compilation fix and preview verification needed for current product imagery.
