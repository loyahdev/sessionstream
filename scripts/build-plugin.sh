#!/bin/zsh
set -eu
cd "${0:A:h:h}"
source scripts/check-build-environment.sh
if [[ ! -f vendor/JUCE/CMakeLists.txt ]]; then
  mkdir -p vendor
  archive="${TMPDIR:-/tmp}/sessionstream-juce-8.0.12.tar.gz"
  curl -L --fail https://codeload.github.com/juce-framework/JUCE/tar.gz/refs/tags/8.0.12 -o "$archive"
  echo 'dec1a8baee5aaec4502b717a421b850e257ab7e9c2efd03766185ec1957cf102  '"$archive" | shasum -a 256 -c -
  tar -xzf "$archive" -C vendor
  mv vendor/JUCE-8.0.12 vendor/JUCE
fi
cmake_command="${CMAKE_PATH:-$(command -v cmake)}"
export DEVELOPER_DIR="${DEVELOPER_DIR:-$(xcode-select -p)}"
"$cmake_command" -S . -B build -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=13.5 -DCMAKE_C_COMPILER="$(xcrun --find clang)" -DCMAKE_CXX_COMPILER="$(xcrun --find clang++)"
"$cmake_command" --build build --config Release -j 4
zsh scripts/bundle-runtime.sh
plugin='build/SessionStream_artefacts/Release/VST3/SessionStream.vst3'
signing=(--force --sign "${SESSIONSTREAM_MAC_SIGNING_IDENTITY:--}")
if [[ "${SESSIONSTREAM_MAC_SIGNING_IDENTITY:--}" != - ]]; then
  signing+=(--timestamp)
fi
for bundle in "$plugin" build/SessionStream_artefacts/Release/AU/SessionStream.component build/SessionStream_artefacts/Release/Standalone/SessionStream.app; do
  codesign "${signing[@]}" "$bundle"
  codesign --verify --deep --strict "$bundle"
done
mkdir -p artifacts
/usr/bin/ditto -c -k --keepParent "$plugin" artifacts/SessionStream-mac-arm64.vst3.zip
shasum -a 256 artifacts/SessionStream-mac-arm64.vst3.zip > artifacts/SHA256SUMS.txt
echo "Plugin: $PWD/$plugin"
echo "Audio Unit: $PWD/build/SessionStream_artefacts/Release/AU/SessionStream.component"
