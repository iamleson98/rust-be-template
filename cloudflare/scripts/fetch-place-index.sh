#!/usr/bin/env bash
# Download the latest weekly place-search index (built by
# .github/workflows/place-index.yml) into public/places/ so a normal code
# deploy ships with it. Run before `opennextjs-cloudflare build`.
#
#   bash scripts/fetch-place-index.sh            # public repo: plain download
#   GH_TOKEN=... bash scripts/fetch-place-index.sh   # private repo: via gh
set -euo pipefail

cd "$(dirname "$0")/.."
repo="${GITHUB_REPOSITORY:-iamleson98/rust-be-template}"
out="public"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

if [ -n "${GH_TOKEN:-}" ] && command -v gh >/dev/null 2>&1; then
  gh release download place-index --repo "$repo" --pattern place-index.tgz --output "$tmp" --clobber
else
  curl --fail --silent --show-error --location --retry 3 \
    -o "$tmp" "https://github.com/$repo/releases/download/place-index/place-index.tgz"
fi

rm -rf "$out/places"
tar -xzf "$tmp" -C "$out"
test -s "$out/places/manifest.json" || { echo "place index missing manifest.json" >&2; exit 1; }
echo "place index installed: $(find "$out/places" -type f | wc -l | tr -d ' ') files"
