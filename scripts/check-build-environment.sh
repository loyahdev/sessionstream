#!/bin/zsh
# Sourced by build scripts before downloads or compilation.
[[ "$(uname -s)" == Darwin && "$(uname -m)" == arm64 ]] || {
  echo 'Build on an Apple Silicon Mac, outside Rosetta.' >&2
  exit 1
}
for tool in node npm cmake curl shasum tar codesign ditto file xcrun; do
  command -v "$tool" >/dev/null || { echo "Missing build tool: $tool. See docs/DEVELOPMENT.md." >&2; exit 1; }
done
node --input-type=module - <<'JS'
import {readFileSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
const fail = message => { console.error(message); process.exit(1); };
if (Number(process.versions.node.split('.')[0]) < 24 || process.arch !== 'arm64')
  fail('Use native arm64 Node.js 24 or newer, then run npm ci.');
const [major, minor] = execFileSync('sw_vers', ['-productVersion'], {encoding:'utf8'}).trim().split('.').map(Number);
if (major < 13 || (major === 13 && minor < 5)) fail('macOS 13.5 or newer is required.');
const manifest = JSON.parse(readFileSync('package.json', 'utf8'));
const displayVersion = readFileSync('version.txt', 'utf8').trim();
if (manifest.version !== `${displayVersion}.0` && manifest.version !== displayVersion)
  fail('package.json and version.txt disagree.');
if (!readFileSync('CMakeLists.txt', 'utf8').includes(`project(SessionStream VERSION ${manifest.version})`) ||
    !readFileSync('installer/Distribution.xml', 'utf8').includes(`version="${manifest.version}"`))
  fail('Update CMakeLists.txt and installer/Distribution.xml to match package.json.');
JS
cloudflared_binary="${CLOUDFLARED_PATH:-$(command -v cloudflared || true)}"
[[ -n "$cloudflared_binary" && -x "$cloudflared_binary" ]] || {
  echo 'Install cloudflared (brew install cloudflared), or set CLOUDFLARED_PATH to its executable.' >&2
  exit 1
}
file -Lb "$cloudflared_binary" | /usr/bin/grep -q arm64 || {
  echo 'cloudflared must include a macOS arm64 binary.' >&2
  exit 1
}
export CLOUDFLARED_PATH="$cloudflared_binary"
[[ -f node_modules/@roamhq/wrtc-darwin-arm64/wrtc.node && -f node_modules/ws/package.json ]] || {
  echo 'Dependencies are missing. Run npm ci, including optional dependencies.' >&2
  exit 1
}
if [[ -d /Library/Developer/CommandLineTools ]]; then
  export DEVELOPER_DIR=/Library/Developer/CommandLineTools
fi
xcrun --find clang++ >/dev/null || { echo 'Install Xcode Command Line Tools: xcode-select --install' >&2; exit 1; }
