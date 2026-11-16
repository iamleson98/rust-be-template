#!/usr/bin/env bash
# Dry run of the asset carry-over and release pruning in update.sh, on fake
# release directories (no root, no systemd, no network):
#
#   bash deploy/vps/test-update-assets.sh
#
# Proves: assets of the last three releases are carried into a new one; an
# older release is not, unless it is younger than 48 hours; a file the new
# release ships is never replaced; pruning keeps the newest three, the active
# and previous releases and everything inside the window, up to ten.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATXEVUI_UPDATE_FUNCTIONS_ONLY=1
# shellcheck source=deploy/vps/update.sh
. "$here/update.sh"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
releases="$tmp/releases"
mkdir -p "$releases"

fail() { echo "FAIL: $*" >&2; exit 1; }
stamp() { date -r "$1" +%Y%m%d%H%M 2>/dev/null || date -d "@$1" +%Y%m%d%H%M; }

# make_release TAG HOURS_OLD: a release that shipped assets/TAG.js and
# assets/shared.js (shared by name, differing by content per release).
make_release() {
  local d="$releases/$1"
  mkdir -p "$d/dist/assets"
  echo "$1" > "$d/dist/assets/$1.js"
  echo "$1" > "$d/dist/assets/shared.js"
  (cd "$d/dist" && find assets -type f | sort) > "$d/.own-assets"
  touch -t "$(stamp $(( $(date +%s) - $2 * 3600 )))" "$d"
}

# Releases by age: v1 is 400 h old ... v6 is 1 h old, plus v7, a fresh install
# of the release under test.
make_release v1 400
make_release v2 300
make_release v3 100
make_release v4 60
make_release v5 3
make_release v6 1

new="$releases/v7"
mkdir -p "$new/dist/assets"
echo new > "$new/dist/assets/v7.js"
echo new > "$new/dist/assets/shared.js"
(cd "$new/dist" && find assets -type f | sort) > "$new/.own-assets"

carry_assets "$releases" "$new"

# The three newest earlier releases (v6, v5, v4) are carried; v3 is 100 h old
# and fourth, v2 and v1 older still.
for tag in v4 v5 v6; do
  [ -f "$new/dist/assets/$tag.js" ] || fail "$tag's asset was not carried"
done
for tag in v1 v2 v3; do
  [ ! -e "$new/dist/assets/$tag.js" ] || fail "$tag's asset was carried out of the window"
done
[ "$(cat "$new/dist/assets/shared.js")" = new ] || fail "a file the new release ships was replaced"

# A fourth release younger than 48 h is carried too (the window is the larger).
for tag in v3 v4; do touch -t "$(stamp $(( $(date +%s) - 20 * 3600 )))" "$releases/$tag"; done
rm -rf "$new/dist/assets/v3.js" "$new/dist/assets/v4.js"
carry_assets "$releases" "$new"
[ -f "$new/dist/assets/v3.js" ] || fail "a release younger than 48 h was not carried"

# Pruning with v7 active and v6 previous: v1, v2 are old and beyond the newest
# three; v3..v5 are inside the window (v3, v4 touched at 20 h; v5 at 3 h).
prune_releases "$releases" "$releases/v7" "$releases/v6"
for tag in v3 v4 v5 v6 v7; do [ -d "$releases/$tag" ] || fail "$tag was pruned"; done
for tag in v1 v2; do [ ! -d "$releases/$tag" ] || fail "$tag was not pruned"; done

# Disk stays bounded: twenty fresh releases leave KEEP_MAX_RELEASES, active included.
for i in $(seq 1 20); do make_release "n$i" 1; touch -t "$(stamp $(( $(date +%s) - i * 60 )))" "$releases/n$i"; done
prune_releases "$releases" "$releases/n20" "$releases/n19"
left="$(releases_newest_first "$releases" | wc -l | tr -d ' ')"
[ "$left" -le "$((KEEP_MAX_RELEASES + 2))" ] || fail "kept $left release directories"
[ -d "$releases/n20" ] && [ -d "$releases/n19" ] || fail "the active or previous release was pruned"

echo "ok: carry-over and pruning behave"
