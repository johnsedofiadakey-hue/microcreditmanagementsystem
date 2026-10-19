#!/usr/bin/env bash
# Satoshi (ITF Free Font License) may be embedded in the app but not redistributed, so it is not in git.
# This downloads the official files from Fontshare into app/src/main/res/font. Run once per checkout.
set -euo pipefail
cd "$(dirname "$0")/.."
dest=app/src/main/res/font
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL -o "$tmp/satoshi.zip" "https://api.fontshare.com/v2/fonts/download/satoshi"
unzip -q "$tmp/satoshi.zip" -d "$tmp/x"
src=$(find "$tmp/x" -type d -path "*WEB/fonts" | head -1)
cp "$src/Satoshi-Medium.ttf" "$dest/satoshi_medium.ttf"
cp "$src/Satoshi-Bold.ttf" "$dest/satoshi_bold.ttf"
cp "$src/Satoshi-Black.ttf" "$dest/satoshi_black.ttf"
echo "Satoshi copied to $dest"
