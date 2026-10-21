#!/usr/bin/env bash
# The ITF Free Font License permits self-hosting for this app but not font redistribution in its public repository.
# Fetch official, unmodified Satoshi files at build time. See ../licenses/Satoshi-ITF-FFL.txt.
set -euo pipefail
cd "$(dirname "$0")/.."
dest=src/fonts
mkdir -p "$dest"
if [[ -s "$dest/satoshi_medium.ttf" && -s "$dest/satoshi_bold.ttf" && -s "$dest/satoshi_black.ttf" ]]; then
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 2 -o "$tmp/satoshi.zip" 'https://api.fontshare.com/v2/fonts/download/satoshi'
unzip -q "$tmp/satoshi.zip" -d "$tmp/x"
src=$(find "$tmp/x" -type d -path '*/WEB/fonts' | head -1)
test -n "$src"
cp "$src/Satoshi-Medium.ttf" "$dest/satoshi_medium.ttf"
cp "$src/Satoshi-Bold.ttf" "$dest/satoshi_bold.ttf"
cp "$src/Satoshi-Black.ttf" "$dest/satoshi_black.ttf"
