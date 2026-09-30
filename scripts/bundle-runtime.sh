#!/bin/zsh
set -eu
cd "${0:A:h:h}"
source scripts/check-build-environment.sh
mkdir -p vendor
if [[ ! -x vendor/node/bin/node ]]; then
  archive="${TMPDIR:-/tmp}/sessionstream-node-v24.3.0.tar.gz"
  curl -L --fail https://nodejs.org/dist/v24.3.0/node-v24.3.0-darwin-arm64.tar.gz -o "$archive"
  curl -L --fail https://nodejs.org/dist/v24.3.0/SHASUMS256.txt -o "${archive}.sha"
  checksum=$(awk '$2 == "node-v24.3.0-darwin-arm64.tar.gz" {print $1}' "${archive}.sha")
  [[ ${#checksum} == 64 ]] || { echo 'Node archive checksum was not found.' >&2; exit 1; }
  echo "$checksum  $archive" | shasum -a 256 -c -
  tar -xzf "$archive" -C vendor
  mv vendor/node-v24.3.0-darwin-arm64 vendor/node
fi
for plugin in build/SessionStream_artefacts/Release/VST3/SessionStream.vst3 build/SessionStream_artefacts/Release/AU/SessionStream.component build/SessionStream_artefacts/Release/Standalone/SessionStream.app; do
  runtime="$plugin/Contents/Resources/runtime"
  [[ ! -d "$runtime" ]] || chmod -R u+w "$runtime"
  mkdir -p "$runtime/bin" "$runtime/node_modules" "$runtime/scripts" "$runtime/notices"
  cp docs/THIRD_PARTY.md docs/NODE-WEBRTC-LICENSE.md docs/CLOUDFLARED-LICENSE.txt "$runtime/notices/"
  cp vendor/JUCE/LICENSE.md "$runtime/notices/JUCE-LICENSE.md"
  cp LICENSE README.md "$runtime/notices/"
  /usr/bin/ditto server "$runtime/server"
  /usr/bin/ditto web "$runtime/web"
  cp scripts/companion.mjs "$runtime/scripts/companion.mjs"
  cp vendor/node/bin/node "$runtime/bin/node"
  cp "$CLOUDFLARED_PATH" "$runtime/bin/cloudflared"
  cp vendor/node/LICENSE "$runtime/bin/NODE-LICENSE"
  for module in ws @roamhq domexception webidl-conversions; do
    /usr/bin/ditto "node_modules/$module" "$runtime/node_modules/$module"
  done
  for binary in "$runtime/bin/node" "$runtime/bin/cloudflared" "$runtime/node_modules/@roamhq/wrtc-darwin-arm64/wrtc.node"; do
    codesign --force --sign - "$binary"
  done
done
