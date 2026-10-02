# SessionStream 0.30 for Windows

The Windows installer contains a VST3 bundle with native **Intel/AMD x64** and **ARM64** plugin binaries. It requires **Windows 11** and a matching 64-bit DAW. A native ARM64 DAW loads the ARM64 binary; an x64 DAW, including one running under emulation on ARM, loads the x64 binary. 32-bit x86 DAWs are not supported.

The streaming engine is a separate process connected to the plugin over local HTTP and UDP. Both plugin architectures use the same pinned **x64 Node.js, WebRTC addon, and cloudflared** runtime. On ARM64 Windows the helper uses Windows 11's x64 emulation. The audio callback itself stays native ARM64. The current WebRTC dependency has no Windows ARM64 prebuilt addon, so this is not an entirely native ARM64 streaming stack.

## Install

Save and close your DAW. Run `SessionStream-0.30-windows-x64-arm64.exe`, approve the administrator prompt, and reopen your DAW. The plugin is installed into `C:\Program Files\Common Files\VST3\SessionStream.vst3`. Rescan VST3 plugins if needed. AU is a macOS format and is not included.

No separate Node.js, npm, or Cloudflare installation is needed. The installer is unsigned and may show a Windows reputation warning. The streaming helper writes its cache into `%LOCALAPPDATA%\SessionStream\Cache`, not the protected plugin directory. Uninstall through Windows Settings > Apps. Close your DAW before updates or uninstalling.

The Windows tunnel supervisor places cloudflared into a job object that kills its process tree when the supervisor exits. It also watches the Node helper. This handles Windows forced termination, where a SIGTERM handler cannot reliably perform cleanup.

The 0.30 release keeps the invite and listener connection during an audio reset. Brief component deactivation/repreparation has a 500 ms grace period before releasing an existing engine lease; audio transmission stops immediately while the component is inactive. Sustained bypass/deactivation and plugin removal still invalidate the invite and release the engine. Seeking no longer releases an active invite.

## Build on Windows

Install Visual Studio 2022 Build Tools with Desktop development with C++, the Windows 11 SDK, and both x64/x86 and ARM64 C++ build tools; CMake 3.22+; Node.js 24+; and NSIS 3.11. Then run in PowerShell from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/build-windows.ps1
```

The script downloads and verifies JUCE 8.0.12, pinned Windows Node v24.3.0, cloudflared 2026.9.3, and the npm packages listed in `package-lock.json`. Both architecture builds share one bundled runtime in the installer. `MAKENSIS_PATH` can override the NSIS compiler location. Use `-Architecture x64 -SkipInstaller` or `-Architecture arm64 -SkipInstaller` to build a single plugin.

The build uses a static C++ runtime for project binaries. The WebRTC addon and Node runtime ship with their dependency notices. End-user installation does not need Visual Studio.

## Cross-build on macOS or Linux

Use LLVM's `clang-cl`, `lld-link`, `llvm-lib`, `llvm-rc`, and `llvm-mt` with the Microsoft SDK/C++ libraries prepared by [xwin](https://github.com/Jake-Shadle/xwin). JUCE 8 does not support MinGW. Point the following CMake options to your local tools and SDK:

```sh
cmake -S . -B build-windows-x64 -G Ninja \
  -DCMAKE_BUILD_TYPE=Release \
  -DCMAKE_TOOLCHAIN_FILE=cmake/windows-clang-cl.cmake \
  -DSESSIONSTREAM_WINDOWS_ARCH=x64 \
  -DSESSIONSTREAM_LLVM=/path/to/llvm/bin \
  -DSESSIONSTREAM_LLD=/path/to/lld-link \
  -DSESSIONSTREAM_WINDOWS_SDK=/path/to/xwin/splat
cmake --build build-windows-x64 --target SessionStream_VST3 windows-tunnel-supervisor vst3-probe plugin-smoke fake-tunnel host-lifecycle seek-reset qr-code windows-process-tree --parallel 4
```

Repeat with `arm64` and `build-windows-arm64`. Then run:

```sh
node scripts/bundle-windows-runtime.mjs --prepare
MAKENSIS_PATH=/path/to/makensis node scripts/build-windows-installer.mjs
```

The installer script verifies the PE machine type of both plugin binaries and all native helper binaries, then writes a SHA-256 manifest of every payload file and a separate installer checksum.

The isolated seek regression uses the compiled `seek-reset` probe, the real local server, and an authenticated PCM listener. Run `node --expose-gc tests/seek-reset.mjs` after building it and installing the host's Node dependencies. `SESSIONSTREAM_SEEK_PROBE` overrides the probe path. The default is `build/seek-reset` on macOS or the x64 Windows build's `seek-reset.exe`. No public tunnel or installed helper is used.

## Validation

Windows-specific checks and their limitations are recorded in [VALIDATION.md](VALIDATION.md). Cross-compilation, payload inspection, and Wine compatibility tests are distinct from native Windows DAW testing. The user confirmed playback and seeking in REAPER on Windows ARM64 in UTM after the 0.20 seeking fix. The loaded plugin architecture was not recorded, so native ARM64 DAW loading and physical Windows performance remain unverified.
