#!/bin/zsh
set -eu
cd "${0:A:h:h}"
source_root="$PWD/build/SessionStream_artefacts/Release"
for relative in VST3/SessionStream.vst3 AU/SessionStream.component; do
  [[ -d "$source_root/$relative" ]] || { echo 'Build both plugin formats first: npm run build:plugin'; exit 1; }
  codesign --verify --deep --strict "$source_root/$relative"
done
for pair in 'VST3:SessionStream.vst3:VST3' 'AU:SessionStream.component:Components'; do
  format="${pair%%:*}"; remainder="${pair#*:}"; bundle="${remainder%%:*}"; folder="${remainder#*:}"
  destination="$HOME/Library/Audio/Plug-Ins/$folder"
  mkdir -p "$destination"
  if [[ -e "$destination/$bundle" ]]; then
    backup="$destination/$bundle.backup-$(date +%Y%m%d-%H%M%S)"
    mv "$destination/$bundle" "$backup"
    echo "Previous version preserved: $backup"
  fi
  /usr/bin/ditto "$source_root/$format/$bundle" "$destination/$bundle"
  codesign --verify --deep --strict "$destination/$bundle"
  echo "Installed: $destination/$bundle"
done
echo 'Save your project and restart your DAW to load this update. Rescan plugins if needed. Use AU in Logic Pro; VST3 or AU in Ableton Live and FL Studio.'
