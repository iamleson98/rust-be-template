#!/usr/bin/env bash
# Regenerate src/geo/apnic-vn.txt — the Vietnam address blocks compiled
# into the backend as the call gate's fallback (production refreshes the
# full APNIC file daily at runtime; see GEO_RANGES_URL). Run from the repo
# root, review the diff, commit.
set -euo pipefail

url=https://ftp.apnic.net/stats/apnic/delegated-apnic-latest
out=src/geo/apnic-vn.txt
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT

curl -fsS --max-time 120 -o "$tmp" "$url"
date=$(grep -m1 '^2|apnic|' "$tmp" | cut -d'|' -f3)
blocks=$(grep -cE '^apnic\|VN\|ipv(4|6)\|' "$tmp" || true)
[ "$blocks" -gt 1000 ] || { echo "only $blocks Vietnamese blocks in $url — refusing"; exit 1; }

{
  echo "# Vietnam's IPv4 and IPv6 blocks from APNIC's delegated statistics"
  echo "# ($url, $date)."
  echo "# APNIC publishes these files for free use and makes no guarantee of"
  echo "# accuracy; they record where each block was first allocated."
  echo "# Regenerate: deploy/geo-snapshot.sh"
  grep -E '^apnic\|VN\|ipv(4|6)\|' "$tmp"
} > "$out"
echo "$out: $blocks blocks as of $date"
