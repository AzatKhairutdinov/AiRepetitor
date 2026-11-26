#!/usr/bin/env bash
# Downloads the prebuilt pdfium library (bblanchon/pdfium-binaries) for this OS and CPU.
# The release must match the pdfium_<n> feature of pdfium-render in Cargo.toml.
# Installs to ~/.local/lib/airepetitor, where the worker looks by default (PDFIUM_LIBRARY overrides).
set -euo pipefail

release=8125
dir="${PDFIUM_DIR:-$HOME/.local/lib/airepetitor}"

case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) asset=mac-arm64 sha=4939bd935ac83ddc09a3a4f038bc43a19cea1660316a3667f26cb07a070e139d lib=libpdfium.dylib ;;
  Darwin-x86_64) asset=mac-x64 sha=8a5193535b80c7215d8932f6647ae5097465b6dba2811602c21e120c2af112b0 lib=libpdfium.dylib ;;
  Linux-x86_64) asset=linux-x64 sha=e1c3ce6e270cb5e0c20816b379ad9f2c1309972697c505f508de92bf5e7d6659 lib=libpdfium.so ;;
  Linux-aarch64) asset=linux-arm64 sha=8b8818f2ec57d1b213d952ca6d7f0ffeca9d0110487d0e20ad83ba918bc92efa lib=libpdfium.so ;;
  *) echo "no pdfium build for $(uname -s) $(uname -m)" >&2; exit 1 ;;
esac

if [ -f "$dir/$lib" ] && [ "$(cat "$dir/pdfium.release" 2>/dev/null)" = "$release-$asset" ]; then
  echo "pdfium $release is already in $dir"
  exit 0
fi

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
echo "downloading pdfium $release ($asset)…"
curl -fsSL -o "$tmp/pdfium.tgz" \
  "https://github.com/bblanchon/pdfium-binaries/releases/download/chromium%2F$release/pdfium-$asset.tgz"
echo "$sha  $tmp/pdfium.tgz" | shasum -a 256 -c - >/dev/null
tar -xzf "$tmp/pdfium.tgz" -C "$tmp" "lib/$lib"
mkdir -p "$dir"
install -m 644 "$tmp/lib/$lib" "$dir/$lib"
echo "$release-$asset" > "$dir/pdfium.release"
echo "installed $dir/$lib"
