#!/usr/bin/env bash
# shot.sh URL OUT.png [WIDTH] [HEIGHT] — headless Firefox screenshot of the Shell:B UI (append ?shot to the URL)
T=$HOME/snap/firefox/common/tmp; mkdir -p "$T"
P=$(mktemp -d -p "$T")
timeout 90 /snap/bin/firefox --headless --no-remote --profile "$P" --window-size="${3:-1440},${4:-900}" --screenshot "$T/shot.png" "$1" >/dev/null 2>&1
mv "$T/shot.png" "$2" && rm -rf "$P"
