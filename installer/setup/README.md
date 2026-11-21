# SessionStream Setup

This is the functional setup build for Apple Silicon Macs running macOS 13.5 or newer and Windows 11 x64 or ARM64.

On macOS, open the disk image and launch **SessionStream Setup** to install the AU and VST3 plug-ins. To remove them, open **Uninstall SessionStream** from the same disk image and choose **Uninstall**. On Windows, run the setup EXE to install the VST3 bundle. To remove it, search Start for **Uninstall SessionStream** or use **Settings → Apps → Installed apps**.

The setup is offline. Each platform includes its original plugin builds, cloudflared, Node.js, WebRTC, and the platform-specific helpers. The streaming runtime lives inside the plugin bundle, where SessionStream already expects it. On Windows ARM64, the DAW loads the ARM64 plugin and runs the x64 streaming helper under Windows 11 emulation.

The Windows setup uses the studio photograph by TStudio from the website. [Photo source](https://www.pexels.com/photo/sounds-equipment-used-in-studio-7173393/)

The disk image and macOS setup share a cover using Brett Sayles’s control-room photograph from the website. [Photo source](https://www.pexels.com/photo/sound-engineer-creating-musical-arrangement-on-computer-in-recording-studio-4105576/)

## Build

On a Mac with Xcode command-line tools, Node.js, 7-Zip (`7zz`), NSIS (`makensis`), the 32-bit MinGW toolchain, and `dmgbuild` 1.6.7, give the build script a directory containing matching `SessionStream-mac-arm64.pkg` and `SessionStream-windows-x64-arm64.exe` release artifacts.

```sh
npm run build:setup
# Or: zsh installer/setup/build.sh /path/to/sessionstream/artifacts
```

The script writes a DMG, an EXE, and SHA-256 checksums to `artifacts/setup/`. Set `DMGBUILD_PATH`, `MAKENSIS_PATH`, or `SEVEN_ZIP_PATH` for tools outside `PATH`. The macOS app is ad-hoc signed by default. Set `SETUP_CODESIGN_IDENTITY` to sign the app with a distribution identity. Public distribution also requires the usual platform signing and macOS notarization steps.

For an already validated combined Windows stage, avoid recompressing an intermediate installer: run `node scripts/bundle-windows-runtime.mjs --prepare`, then `node scripts/build-windows-installer.mjs --stage-only`, and set `SESSIONSTREAM_SETUP_WINDOWS_STAGE="$PWD/artifacts/windows-stage"` when running the setup builder. The builder still checks both plugin architectures, helper presence and matching runtime/release versions.
