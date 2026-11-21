# SessionStream website design

## Direction

A serious audio tool with an underground studio identity. Preserve the full-screen photographic hero, oversized readable Manrope wordmark, centred complete native plugin, slight overlap, off-white Download button and asymmetric scroll rounding. Ableton and Teenage Engineering informed the original direction; the final page follows SessionStream’s own bold typography, real studio imagery, dark working surfaces and precise dividers. No orange, generic feature cards, decorative UI or fabricated customers.

The November 20 pass compares the live https://sessionstream.app site with this local design. It restores useful subject matter from the live site without adopting its softer card layout or replacing the approved hero.

## Page structure

1. Full-screen studio hero, then a small platform/credit line.
2. Your DAW / Their browser: a concrete introduction and static annotated native close-up.
3. Go directly from the Send explanation to the browser listener; mix checking and client feedback belong in that explanation.
4. The browser listener: native interface image and an explanation of mix checking and client listening.
5. Audio & control within the dark listener section: current Pro quality presets, gain independence, Live Opus and Buffered PCM.
6. Pro studio photograph with concrete class access details and price, followed by an oversized DAW TO DAW composition and the actual native Receive module. Cloud Relay remains an explicit availability disclosure.
7. Dedicated VST3 / AU compatibility spread with platform requirements and the six existing DAW assets.
8. Free / Pro comparison.
9. Platform downloads and installation instructions, linking back to compatibility instead of repeating it.
10. Practical questions, including Free accounts and using a separate voice/video call.
11. Original oversized footer wordmark, animated spectrum and expanded section navigation.

## Sources and assets

- Root `index.html` is the homepage. `websrc/home.css` is its standalone stylesheet; do not load accumulated experimental `styles.css` overrides.
- `websrc/colors.css` loads before `home.css`. Follow `COLOR-GUIDE.md`: mineral neutrals and charcoal, lime actions, violet editorial emphasis and right waveform lane, teal focus. Native interface images retain their original colours.
- Manrope and DM Sans are local assets. Archivo Black remains unused and is excluded from the public package.
- Hero: existing Brett Sayles studio photograph, with attribution.
- Pro: existing Kaiser Leo Xiv producer/vocal-booth photograph, with attribution. It illustrates studio work and does not represent a documented SessionStream class.
- Native Send, Receive and Pro settings exports are 3440×2040. The browser export is 2088×2492. See `PLUGIN-IMAGE-EXPORTS.md` for provenance.
- DAW marks reuse the six existing packaged assets; no additional photography or fonts were downloaded.

## Annotations

The hero shows the complete plugin. The connection section crops it to native bounds x=48..3392, y=240..1904, preserving complete control panels and rounded edges while omitting the app masthead and bottom status strip.

The image and connectors use a 1000×580 artboard. Private invite and Session controls connect to the adjacent right edge. Stream level has a wider text area beneath the plugin and a connector that comes up from below. Lines stay outside the meters and spectrum, at 0.8px and 55% opacity, with small neutral endpoints. There are no letters, highlight boxes, selected states or annotation click handlers. Images are static; there is no enlargement control.

At widths up to 1100px, show a focused crop of the native sharing module (x2392, y390, 920 by 550). Hide the annotation glossary rather than creating another stack of text rows.

## Current product facts

- Free: up to three browser listeners; no account required to start.
- Pro: $5 USD/month, up to eight local listeners, reusable invites, waiting room/access controls, quality presets and Receive mode.
- Cloud Relay for up to 30 listeners is planned, unavailable and outside the current subscription. The live website advertises cloud capacity more broadly; this local design retains the implementation-backed availability distinction.
- Preset target bitrates are verified in `server/session-policy.mjs`: Studio 510000, Balanced 320000, Phone 96000 bits/s. They apply to compressed stereo Opus; actual bitrate varies. Buffered PCM is separately lossless and adds bandwidth/delay.
- No fixed latency promise is copied from the live site. Delay depends on the device, network and settings.
- Apple Silicon macOS 13.5+: VST3 and AU. Windows 11 x64/ARM64: VST3, matching the host architecture. Intel Macs, AAX and 32-bit/browser-only hosts are excluded.

## Preserved behavior

- Hero matches the viewport, then scales to 94% and gains its rounded corner while scrolling. Reduced motion remains supported.
- The separate local Nocturnal excerpt player has been removed. Show the actual browser listener and explain its monitoring controls without implying a local clip is a streaming demonstration.
- Product images are static. Account/download/checkout handlers, plan comparison and FAQ disclosures remain intact.
- The original footer identity and 100 animated spectrum bars remain.
- Mobile navigation uses a native details disclosure. Selecting a section closes it; Escape closes it and returns focus to Menu. It remains usable without JavaScript.

## Verification

Reviewed the live site’s use cases, compatibility, audio explanation and public download configuration in the browser. The existing public macOS PKG and Windows EXE filenames match the current download handlers. Installer binaries and purchasing were not executed.

Local browser checks cover 320/390px phones, 768px tablet, 1100/1280/1440px desktop, light/dark appearance, no horizontal or heading overflow, readable quality tables, full-height hero, native image assets, mobile section selection and Escape, FAQ disclosures, audio play/pause/Mono/Dim/reset, default 100% volume and footer initialization. HTML nesting, IDs, anchors, packaged assets, JavaScript syntax and website build are checked separately.

The page remains a local review build until production is deployed. No plugin, authentication, billing or installer implementation was changed by this pass.

## Cohesive page rhythm

The final review follows NN/g guidance on shared grids, typographic hierarchy and deliberate colour, and the GOV.UK design system approach to responsive spacing. SessionStream retains its own photography, oversized identity and palette.

The page uses shared edge, section-space, section-gap, campaign-title and section-title tokens. Desktop spacing follows a restrained 8px rhythm, with 64/48px section spacing and 40/24px gaps at narrower breakpoints. Product, listener and Pro headings share a scale; practical headings and body text use consistent subordinate sizes. Copy widths are limited for readability.

Colour changes now follow the story: hero photograph, a continuous light introduction/use-case area, the dark listening surface flowing into the Pro studio photograph, then a continuous light practical area through compatibility, pricing and installation. The lime Pro banner, additional dark compatibility block and violet pricing fill were removed. Lime remains functional; violet is a restrained text/rule accent. Layouts still vary according to content, without changing the visual system at every section.

Dead CSS for removed Send/Listen/Receive tabs and the old setup layout is removed. Existing audio, native disclosures, menus, account/download actions and hero motion remain.

References: https://www.nngroup.com/articles/good-visual-design/ and https://design-system.service.gov.uk/styles/spacing/

Cohesion pass verification: checked 320×844, 390×844, 768×1024, 1100×900, 1280×720 and 1440×1000. Hero height matches the viewport, headings fit, and no horizontal overflow occurs. Reviewed complete section transitions, dark-mode legibility, mobile navigation, live audio play/pause/Mono/Dim/reset at 100%, and the transport disclosure. CSS parses without warnings, HTML/IDs/anchors/assets pass checks, and browser console errors are absent. Screenshots are prefixed `cohesion-` in the November 20 artifact directory.

## Remove microcopy clutter

The user clarified that the remaining clutter was mostly small supplementary text, not the main section structure. Removed decorative eyebrow labels, version registers, example captions, repeated Free/Pro tags, duplicated introductory paragraphs, the extra teaching connection strip and repeated technical metadata. Main explanations are shorter. Pro has one supporting sentence and a price-bearing action. Audio specifications and unsupported-system details remain available through native disclosures. Pricing, listener limits, supported platforms, installation instructions and Cloud Relay availability remain explicit where relevant. Audio status text remains accessible to screen readers without adding another visible caption.

Photograph sources remain recorded here rather than adding visual credit lines throughout the page: Brett Sayles, https://www.pexels.com/photo/sound-engineer-creating-musical-arrangement-on-computer-in-recording-studio-4105576/ ; Kaiser Leo Xiv, https://www.pexels.com/photo/a-man-in-a-recording-studio-with-a-keyboard-28003176/ .

## Footer and download emphasis

The footer contact block now stacks the support address beneath the brand, with a deliberate two-column six-link navigation. Terms and Privacy sit in the bottom legal row. The oversized identity remains, rendered as responsive SVG text using the existing Manrope weight, so the wordmark fills the same grid as the animated spectrum without a fixed-font-size width mismatch on wide screens. The 100 animated bars are retained in a more compact aligned strip.

The installation section now says Download SessionStream and has a restrained violet top rule. macOS and Windows are presented as two clear rows in one bordered download picker, with lime download icons and stronger labels. Existing data-download handlers are unchanged; platform details and the close-DAW instruction remain.

## Static product imagery

All product images are now static page content. Removed the hero/listener image buttons, View full interface, View browser interface, View session settings and View Receive mode actions, the image lightbox markup and its JavaScript handlers. Preserved native image dimensions and meaningful alt text. Removed zoom cursors and unnecessary image-related tab stops. The separate error dialog used by account/download actions remains intact.

## Product story revision

Removed the generic four-use-case list and the narrow-screen three-row annotation glossary. The listener copy now explains mix checking and client feedback where the listening interface is shown. Pro teaching explains actual capacity and access controls rather than repeating three benefit headings. A dedicated DAW TO DAW composition shows the actual Receive control module, cropped to x2340, y256, 1040 by 1632, avoiding its empty spectrum. Collaboration navigation points to this section. Preserve the approved hero.

## Remove the local excerpt player

Removed the Nocturnal excerpt controls, waveform, guidance and Web Audio implementation. The section now uses one genuine listener interface beside its explanation, with audio specifications available on demand. Audio source assets remain in the project for possible future use.

## Final pre-push pass

Product introduction now spells out the plugin-to-browser flow and clarifies that listeners install nothing. Listener and teacher headings describe their actual purpose. Teaching states eight current listeners and access controls; the comparison table explicitly excludes planned Cloud Relay from both current plans. Receive uses two contiguous visual crops of the original native capture to omit the blank middle (upper x2340/y256/1040/1000 and lower x2340/y1688/1040/200); no controls or connected states are fabricated. Narrow Send crops show the native Copy link, QR and passcode actions, avoiding the fixture URL and duplicate glossary. Removed the retired 2 MB audio demo and unused studio-hands photograph from the public package, retaining local source assets.

Final review: see `WEBSITE-REVIEW-2026-11-20.md` for verified browser sizes, public endpoint checks and the unresolved email-provider rejection. Removed the legacy rule hiding the real listener image on phones. Marketing CSS is minified at package time. Failed download configuration requests clear their cache so a second click can retry.
