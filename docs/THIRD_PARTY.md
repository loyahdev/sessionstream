# Dependencies

- JUCE 8.0.12: https://github.com/juce-framework/JUCE/tree/8.0.12 — AGPLv3/commercial dual license. The build downloads `vendor/JUCE/LICENSE.md`, which includes dependency notices, and copies it to `runtime/notices/JUCE-LICENSE.md`. Download SHA-256: `dec1a8baee5aaec4502b717a421b850e257ab7e9c2efd03766185ec1957cf102`.
- ws: MIT. See `node_modules/ws/LICENSE`.
- Playwright (test only): Apache-2.0. See `node_modules/playwright/LICENSE`.
- cloudflared (bundled runtime): Apache-2.0. https://github.com/cloudflare/cloudflared

SessionStream's project source is AGPL-3.0-only. This is not a Waves product and does not use Waves code or branding.

The Windows installer uses NSIS 3.11 (https://nsis.sourceforge.io/). Its installer stub, UI/plugins, and compression components have the licenses listed in [NSIS-LICENSE.txt](NSIS-LICENSE.txt), included in the Windows runtime notices.

## Bundled native runtime

- Official Node.js v24.3.0 macOS arm64 or Windows x64: https://nodejs.org/dist/v24.3.0/ — the complete bundled Node license and third-party notices are in `runtime/bin/NODE-LICENSE`.
- @roamhq/wrtc 0.10.0: BSD-2-Clause. https://github.com/WonderInventions/node-webrtc — see `NODE-WEBRTC-LICENSE.md`. Its prebuilt macOS arm64 and Windows x64 addons embed WebRTC (BSD-style licensing) and dependencies.
- domexception: MIT. Its package contains `LICENSE.txt`.
- webidl-conversions: BSD-2-Clause. Its package contains `LICENSE.md`.
- cloudflared ships with the plugin; no separate runtime installation is required. Apache-2.0: see [CLOUDFLARED-LICENSE.txt](CLOUDFLARED-LICENSE.txt), copied into `runtime/notices/` by the build. The macOS builder's installed version is used; Windows uses pinned cloudflared 2026.9.3 for x64 with SHA-256 verification.

- QR Code generator by Project Nayuki: MIT. The pinned C++ source is under `plugin/third_party/`, with `LICENSE-qrcodegen.txt` copied into the bundled notices. Official source: https://github.com/nayuki/QR-Code-generator/tree/3c6d0b3cefb4e049dc337e82237c9644399716a8/cpp
