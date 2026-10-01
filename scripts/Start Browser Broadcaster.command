#!/bin/zsh
set -eu
cd "${0:A:h:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[[ -d node_modules ]] || npm ci
(sleep 3; open http://127.0.0.1:8788/studio) &
exec npm run start:tunnel
