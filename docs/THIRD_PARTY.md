# Dependencies

- JUCE 8.0.12: https://github.com/juce-framework/JUCE/tree/8.0.12 — AGPLv3/commercial dual license. The build downloads `vendor/JUCE/LICENSE.md`, which includes dependency notices, and copies it to `runtime/notices/JUCE-LICENSE.md`. Download SHA-256: `dec1a8baee5aaec4502b717a421b850e257ab7e9c2efd03766185ec1957cf102`.
- ws: MIT. See `node_modules/ws/LICENSE`.
- Playwright (test only): Apache-2.0. See `node_modules/playwright/LICENSE`.
- cloudflared (bundled runtime): Apache-2.0. https://github.com/cloudflare/cloudflared

SessionStream's project source is AGPL-3.0-only. This is not a Waves product and does not use Waves code or branding.

## Bundled native runtime (0.10)

- Official Node.js v24.3.0 macOS arm64: https://nodejs.org/dist/v24.3.0/ — the complete bundled Node license and third-party notices are in `runtime/bin/NODE-LICENSE`.
- @roamhq/wrtc 0.10.0: BSD-2-Clause. https://github.com/WonderInventions/node-webrtc — see `NODE-WEBRTC-LICENSE.md`. Its prebuilt macOS arm64 addon embeds WebRTC (BSD-style licensing) and dependencies.
- domexception: MIT. Its package contains `LICENSE.txt`.
- webidl-conversions: BSD-2-Clause. Its package contains `LICENSE.md`.
- cloudflared is bundled in 0.10, rather than required as an external runtime. Apache-2.0: see [CLOUDFLARED-LICENSE.txt](CLOUDFLARED-LICENSE.txt), copied into `runtime/notices/` by the build. The builder's installed cloudflared version is used.
