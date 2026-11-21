#!/bin/zsh
set -eu

if (( $# != 1 )); then
  print -u2 "Usage: zsh installer/setup/build.sh RELEASE_ARTIFACTS_DIRECTORY"
  exit 2
fi

root="${0:A:h:h:h}"
release="${1:A}"
mac_package="$release/SessionStream-mac-arm64.pkg"
windows_installer="$release/SessionStream-windows-x64-arm64.exe"
windows_stage="${SESSIONSTREAM_SETUP_WINDOWS_STAGE:-}"
output="$root/artifacts/setup"
work=$(mktemp -d "${TMPDIR:-/tmp}/sessionstream-setup.XXXXXX")
trap 'rm -rf "$work"' EXIT

# Use the full offline release payloads, including resources and bundled helpers.
[[ -f "$mac_package" && ( -f "$windows_installer" || -d "$windows_stage/SessionStream.vst3" ) ]] || {
  print -u2 "Both platform installers are required in $release."
  exit 1
}
mkdir -p "$output"
/usr/sbin/pkgutil --expand "$mac_package" "$work/pkg"
distribution="$work/pkg/Distribution"
version=$(/usr/bin/xmllint --xpath 'string(/installer-gui-script/pkg-ref[@id="dev.loyah.sessionstream.vst3"]/@version)' "$distribution")
home_domain=$(/usr/bin/xmllint --xpath 'string(/installer-gui-script/domains/@enable_currentUserHome)' "$distribution")
[[ "$version" == <->.<->.<-> && "$home_domain" == true ]] || {
  print -u2 "The macOS package must declare a release version and allow per-user installation."
  exit 1
}
/usr/sbin/pkgutil --payload-files "$mac_package" > "$work/mac-payload.txt"
for bundle in VST3/SessionStream.vst3 Components/SessionStream.component; do
  for component in bin/cloudflared bin/node bin/account-credentials node_modules/@roamhq/wrtc-darwin-arm64/wrtc.node; do
    /usr/bin/grep -Fxq "./Library/Audio/Plug-Ins/$bundle/Contents/Resources/runtime/$component" "$work/mac-payload.txt"
  done
done

stage="$work/windows"
plugin="$stage/SessionStream.vst3"
if [[ -n "$windows_stage" ]]; then
  [[ -d "$windows_stage/SessionStream.vst3" ]] || { print -u2 "Missing staged Windows plugin."; exit 1; }
  /usr/bin/ditto "$windows_stage/SessionStream.vst3" "$plugin"
else
  "${SEVEN_ZIP_PATH:-7zz}" x -y "-o$plugin" "$windows_installer" 'Contents/*' > /dev/null
fi
runtime="$plugin/Contents/Resources/runtime"
[[ "$(<"$plugin/Contents/Resources/sessionstream-version.txt")" == "$version" &&
   "$(node -p 'require(process.argv[1]).version' "$runtime/runtime-manifest.json")" == "$version" ]] || {
  print -u2 "The macOS and Windows payload versions must match."
  exit 1
}
for component in \
  x86_64-win/SessionStream.vst3 arm64-win/SessionStream.vst3 \
  Resources/runtime/bin/cloudflared.exe Resources/runtime/bin/node.exe \
  Resources/runtime/bin/account-credentials.exe Resources/runtime/bin/windows-tunnel-supervisor.exe \
  Resources/runtime/node_modules/@roamhq/wrtc-win32-x64/wrtc.node; do
  [[ -s "$plugin/Contents/$component" ]] || { print -u2 "Missing Windows payload file: $component"; exit 1; }
done

mac_name="SessionStream-Setup-${version}-mac-arm64.dmg"
windows_name="SessionStream-Setup-${version}-windows-x64-arm64.exe"
app="$work/image/SessionStream Setup.app"
uninstaller="$work/image/Uninstall SessionStream.app"
mkdir -p "$app/Contents/"{MacOS,Resources} "$uninstaller/Contents/"{MacOS,Resources}
/bin/cp "$mac_package" "$app/Contents/Resources/SessionStream.pkg"
photo="$root/websrc/assets/studio-hands.webp"
artwork="$work/artwork"
mkdir -p "$artwork"
/usr/bin/swift -module-cache-path "$work/module-cache" "$root/installer/setup/DrawDiskImage.swift" \
  "$artwork" "$root/websrc/assets/studio-session.webp"
/bin/cp "$artwork/Cover.png" "$app/Contents/Resources/Cover.png"
/bin/cp "$artwork/Cover.png" "$uninstaller/Contents/Resources/Cover.png"
/usr/bin/tiffutil -cathidpicheck "$artwork/Background.png" "$artwork/Background@2x.png" -out "$artwork/Background.tiff"
for icon in Setup Uninstall; do
  iconset="$artwork/$icon.iconset"
  mkdir -p "$iconset"
  for icon_size in 16 32 128 256 512; do
    /usr/bin/sips -z "$icon_size" "$icon_size" "$artwork/$icon.png" --out "$iconset/icon_${icon_size}x${icon_size}.png" >/dev/null
    /usr/bin/sips -z "$((icon_size * 2))" "$((icon_size * 2))" "$artwork/$icon.png" --out "$iconset/icon_${icon_size}x${icon_size}@2x.png" >/dev/null
  done
  /usr/bin/iconutil -c icns "$iconset" -o "$artwork/$icon.icns"
done
/bin/cp "$artwork/Setup.icns" "$app/Contents/Resources/Setup.icns"
/bin/cp "$artwork/Uninstall.icns" "$uninstaller/Contents/Resources/Setup.icns"
cat > "$app/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>SessionStreamSetup</string>
  <key>CFBundleIdentifier</key><string>dev.loyah.sessionstream.setup</string>
  <key>CFBundleName</key><string>SessionStream Setup</string>
  <key>CFBundleIconFile</key><string>Setup.icns</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>$version</string>
  <key>CFBundleVersion</key><string>$version</string>
  <key>LSMinimumSystemVersion</key><string>13.5</string>
  <key>NSHighResolutionCapable</key><true/>
</dict></plist>
PLIST
/usr/bin/swiftc -parse-as-library -O -target arm64-apple-macos13.5 \
  -module-cache-path "$work/module-cache" "$root/installer/setup/SessionStreamSetup.swift" \
  "$root/installer/setup/SetupView.swift" \
  -o "$app/Contents/MacOS/SessionStreamSetup"
/bin/cp "$app/Contents/MacOS/SessionStreamSetup" "$uninstaller/Contents/MacOS/SessionStreamSetup"
/bin/cp "$app/Contents/Info.plist" "$uninstaller/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleIdentifier -string dev.loyah.sessionstream.uninstall "$uninstaller/Contents/Info.plist"
/usr/bin/plutil -replace CFBundleName -string "Uninstall SessionStream" "$uninstaller/Contents/Info.plist"
for bundle in "$app" "$uninstaller"; do
  /usr/bin/codesign --force --sign "${SETUP_CODESIGN_IDENTITY:--}" --options runtime "$bundle"
  /usr/bin/codesign --verify --strict "$bundle"
done
"${DMGBUILD_PATH:-dmgbuild}" -s "$root/installer/setup/dmg-settings.py" \
  -D "app=$app" -D "uninstaller=$uninstaller" -D "background=$artwork/Background.tiff" \
  -D "icon=$app/Contents/Resources/Setup.icns" "SessionStream Setup" "$work/$mac_name"

"${WINDOWS_WINDRES_PATH:-i686-w64-mingw32-windres}" -DUNICODE -D_UNICODE \
  -i "$root/installer/setup/WindowsSetup.rc" -O coff -o "$work/dialogs.o"
"${WINDOWS_LD_PATH:-i686-w64-mingw32-ld}" --subsystem windows --entry 0 \
  -o "$work/dialogs.exe" "$work/dialogs.o"
mkdir -p "$work/plugins"
/usr/bin/sips -s format bmp -Z 640 "$photo" --out "$work/Studio.bmp" >/dev/null
"${WINDOWS_CC_PATH:-i686-w64-mingw32-gcc}" -shared -O2 -Wall -Wextra -Werror \
  "$root/installer/setup/WindowsSwitch.c" -o "$work/plugins/StudioSwitch.dll" \
  -lcomctl32 -lgdi32 -luser32
"${MAKENSIS_PATH:-makensis}" -WX "-DPROJECT_DIR=$root" "-DSTAGE_DIR=$stage" \
  "-DOUTPUT_FILE=$work/$windows_name" "-DPACKAGE_VERSION=$version" "-DDISPLAY_VERSION=$version" \
  "-DSETUP_DIALOGS=$work/dialogs.exe" "-DSETUP_PLUGINS=$work/plugins" "-DSETUP_PHOTO=$work/Studio.bmp" \
  -DSESSIONSTREAM_SETUP "$root/installer/windows/sessionstream.nsi"

/bin/mv "$work/$mac_name" "$work/$windows_name" "$output/"
cd "$output"
/usr/bin/shasum -a 256 "$mac_name" "$windows_name" > "SHA256SUMS-$version.txt"
print -r -- "$output/$mac_name" "$output/$windows_name"
