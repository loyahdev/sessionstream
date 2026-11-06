#!/bin/zsh
set -eu
cd "${0:A:h:h}"
package_version=$(node -p "require('./package.json').version")
[[ "$package_version" == <->.<->.<-> ]] || { echo 'package.json must contain a dotted package version.' >&2; exit 1; }
# Artifact names use the display version from the package manifest.
display_version=$(node -p "require('./package.json').version.replace(/\\.0$/, '')")
installer_output="artifacts/SessionStream-${display_version}-mac-arm64.pkg"
announcement_version=$(<version.txt)
[[ "$announcement_version" == "$display_version" || "$announcement_version" == "$package_version" ]] || {
  echo 'version.txt must match package.json.' >&2; exit 1;
}
/usr/bin/grep -Fq "version=\"${package_version}\"" installer/Distribution.xml || { echo 'Update installer/Distribution.xml to match package.json.' >&2; exit 1; }
plugin="$PWD/build/SessionStream_artefacts/Release/VST3/SessionStream.vst3"
audio_unit="$PWD/build/SessionStream_artefacts/Release/AU/SessionStream.component"
[[ -d "$plugin" && -d "$audio_unit" ]] || { echo 'Build both plugin formats first: npm run build:plugin'; exit 1; }
for bundle in "$plugin" "$audio_unit"; do
  [[ "$(/usr/bin/plutil -extract CFBundleShortVersionString raw -o - "$bundle/Contents/Info.plist")" == "$package_version" ]] || { echo 'Plugin version differs from package.json. Rebuild: npm run build:plugin' >&2; exit 1; }
done
codesign --verify --deep --strict "$plugin"
codesign --verify --deep --strict "$audio_unit"
work=$(mktemp -d "${TMPDIR:-/tmp}/sessionstream-pkg.XXXXXX")
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/root/Library/Audio/Plug-Ins/VST3" "$work/root/Library/Audio/Plug-Ins/Components" "$work/packages" artifacts
/usr/bin/ditto "$plugin" "$work/root/Library/Audio/Plug-Ins/VST3/SessionStream.vst3"
/usr/bin/ditto "$audio_unit" "$work/root/Library/Audio/Plug-Ins/Components/SessionStream.component"
# Full replacement prevents stale runtime files from surviving an update.
cat > "$work/components.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><array><dict>
<key>RootRelativeBundlePath</key><string>Library/Audio/Plug-Ins/VST3/SessionStream.vst3</string>
<key>BundleIsRelocatable</key><false/>
<key>BundleIsVersionChecked</key><true/>
<key>BundleHasStrictIdentifier</key><true/>
<key>BundleOverwriteAction</key><string>upgrade</string>
</dict><dict>
<key>RootRelativeBundlePath</key><string>Library/Audio/Plug-Ins/Components/SessionStream.component</string>
<key>BundleIsRelocatable</key><false/>
<key>BundleIsVersionChecked</key><true/>
<key>BundleHasStrictIdentifier</key><true/>
<key>BundleOverwriteAction</key><string>upgrade</string>
</dict></array></plist>
PLIST
pkgbuild --root "$work/root" --identifier dev.loyah.sessionstream.vst3 --version "$package_version" --install-location / --ownership recommended --component-plist "$work/components.plist" "$work/packages/SessionStream-component.pkg"
productbuild --distribution installer/Distribution.xml --resources installer/resources --package-path "$work/packages" "$installer_output"
shasum -a 256 artifacts/SessionStream-mac-arm64.vst3.zip "$installer_output" > artifacts/SHA256SUMS.txt
echo "Installer: $PWD/$installer_output"
