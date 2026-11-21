# Native plugin website image exports

Exports on November 18, 2026 use the actual SessionStream native editor with an isolated local Pro fixture, no real account or public tunnel.

- Send: `/private/tmp/sessionstream-stable-live.png`, 3440 × 2040. Isolated rich synthetic input provides a real spectrum display.
- Receive: `/private/tmp/sessionstream-receive-4x.png`, 3440 × 2040. Ready-to-receive state.
- Pro Settings: `/private/tmp/sessionstream-stable-settings.png`, 3440 × 2040. Real quality, link and passcode controls.
- Website assets are lossless WebP, with rounded clipping applied by CSS to each image's actual bounds. No upscaling or generated replacement UI.

The native preview harness now accepts `SESSIONSTREAM_EDITOR_SNAPSHOT_SCALE` from 1 to 4, defaulting to its previous 2× behavior. The native editor workflow reached its PASS assertions and the images exported successfully. Both Node capture runners exited with code 139 during shutdown after their success output; this is not recorded as a clean end-to-end native test pass. The website build and browser checks are separate.

The browser listener asset was replaced with a fresh 2088×2492 capture rendered from the actual `web/` listener HTML, local fonts, styles and application script at 4× CSS scale in an isolated local fixture. Its ready state is labeled as an example. It is not an upscale of the old 522-pixel asset. The browser capture was JPEG; the cropped image is distributed as lossless-encoded WebP to avoid further lossy compression. The image's own aspect ratio is used by the rounded website frame.
