# SessionStream color guide

A restrained studio palette: mineral neutrals, forest green, signal lime, and a small teal accent, with muted violet reserved for a few editorial details. No orange. Photography and the original product screenshots retain their own color.

## Professional guidance

- [IBM Carbon: Color](https://www.carbondesignsystem.com/building-blocks/foundations/color/overview): neutral surfaces establish hierarchy; role-based tokens keep themes and interaction states consistent. Apply one primary action family and use other colors with purpose.
- [Atlassian: Color](https://atlassian.design/foundations/color/): distinguish brand, selection, focus, and status roles; keep selected states different from keyboard focus; use accessible foreground/background pairs.

The following palette is custom to SessionStream. It uses these systems' methods, not their brand colors.

## Palette and placement

| Role | Light theme | Dark theme | Where it belongs |
| --- | --- | --- | --- |
| Canvas | `#F4F5F0` | `#111A16` | Page background |
| Surface | `#FFFFFF` | `#1B2721` | Forms, account panels, raised UI |
| Muted surface | `#E8EDE5` | `#202F26` | Secondary surfaces and neutral hover |
| Main text | `#26332A` | `#ECF1E7` | Headings, copy, labels |
| Secondary text | `#58665C` | `#A6B5AA` | Supporting copy and metadata |
| Forest / brand | `#315C3F` | `#8AC596` | Links, monitor controls, Pro label, small functional accents |
| Signal lime | `#C2E879` | `#C2E879` | Main download/upgrade actions, active playback, brand mark, footer spectrum |
| Text on signal | `#19251C` | `#19251C` | Dark text on lime; never white text on lime |
| Selected surface | `#DCEAD8` | `#283F30` | Selected preview tabs and monitor options |
| Selected text | `#284E34` | `#C2E879` | Selected label, accompanied by pressed/selected state |
| Muted violet | `#74638F` | `#BAA7D7` | Product/download emphasis, faint signal linework, small Pro label |
| Focus / teal | `#17756E` | `#76C8BF` | Keyboard focus; kept distinct from selection |
| Control border | `#738677` | `#708576` | Input and button boundaries |
| Subtle border | `#C8D2C6` | `#34483B` | Nonessential separators |
| Success | `#256E45` | `#8ED0A0` | Actual successful outcomes, with icon/text |
| Danger | `#B63D50` | `#F1A0AC` | Errors and destructive actions, with icon/text |
| Warning | `#846522` | `#DCC979` | Actual caution, with icon/text; not decoration |

## Audio display

The dark audio surface stays consistent in either theme: `#121E18`.

| Signal role | Peak | RMS body | Meaning |
| --- | --- | --- | --- |
| Left | `#70965A` | `#BBD986` | Left audio channel, labeled L |
| Right | `#83709F` | `#BAA7D7` | Right audio channel, labeled R |
| Mono | Same as left | Same as left | Summed mono in both lanes, labeled M |

The ruler stays neutral. The playhead is off-white. Upcoming audio uses quieter versions of each channel hue. Color never substitutes for channel labels or pressed states. Waveform color does not imply a success or error.

## Application rules

- Use muted violet only for editorial emphasis. It is not a status, selected state, focus indicator, or primary action.
- Keep most surfaces neutral. Spend the bright lime on primary actions and active playback, rather than every link, label or section.
- Use forest for readable interactive text on light backgrounds. Lime is unsuitable for small text on the light canvas.
- Selected controls use tonal green, a label, and an accessible pressed/selected state. Keyboard focus uses teal with an outline.
- The hero and footer use inverse text on charcoal. Hero focus rings use signal lime with a dark outer edge for clarity over photography.
- Marketing, sign-in/up, dashboard, billing, and legal pages share `websrc/colors.css`. Existing layout and auth/checkout behavior are unchanged.
- The canvas waveform reads the same CSS tokens as the rest of the site. Do not add independent hardcoded channel colors in JavaScript.
- Do not recolor third-party product screenshots or turn stock photographs into a palette demonstration.

## Verified contrast

Calculated with WCAG relative luminance, using exact token pairs. These checks cover this palette; they are not a claim of a complete accessibility audit.

| Foreground / background | Contrast |
| --- | --- |
| Muted violet / light canvas | 4.88:1 |
| Muted violet / dark canvas | 8.11:1 |
| Main text / light canvas | 12.06:1 |
| Secondary text / light canvas | 5.52:1 |
| Forest / light canvas | 7.01:1 |
| Dark text / signal lime | 11.43:1 |
| Teal focus / light canvas | 5.04:1 |
| Control border / light canvas | 3.55:1 |
| Selected text / selected light surface | 7.54:1 |
| Main text / dark canvas | 15.47:1 |
| Secondary text / dark canvas | 8.29:1 |
| Teal focus / dark canvas | 9.11:1 |
| Left peak / audio surface | 5.06:1 |
| Left RMS body / audio surface | 10.93:1 |
| Right peak / audio surface | 3.91:1 |
| Right RMS body / audio surface | 7.84:1 |

Normal-sized text targets at least 4.5:1; meaningful control boundaries and graphical information target at least 3:1. Faint separators and upcoming waveform previews are supplemental, not the only indication of a state.

Pro feature spreads use the same charcoal inverse surface, signal CTA, and inverse violet (`--ss-accent-violet-on-dark`) for feature emphasis and roadmap annotation. The cloud availability statement is always explicit text. Native product screenshots keep their actual interface colors and are not recolored.
