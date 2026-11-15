#!/usr/bin/env bash
# A small place index for both sides, built from one hand-made OSM extract
# (make-osm-pbf.mjs): no Geofabrik download.
#
#   Rust: `backend places-build`, fetching the extract from a throwaway local HTTP server
#         (SEARCH_OSM_DOWNLOAD_URL), publishes a generation under $PARITY_WORK/rust/places.
#   REF:  with PLACE_EXTRACT_BIN (the tools/place-extract binary) the same extract becomes
#         NDJSON and then the Worker's static shards in the REF copy's public/places, which
#         `next dev` serves through its ASSETS binding (the Worker's fallback engine,
#         "static-shards"). Run it after serve-ref.sh has copied the reference once.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
. "$here/env.sh"
src="$PARITY_WORK/osm"
mkdir -p "$src" "$PARITY_WORK/rust/places"
node "$here/make-osm-pbf.mjs" "$src/extract.osm.pbf" --pad

port=${OSM_HTTP_PORT:-3199}
(cd "$src" && python3 -m http.server "$port" --bind 127.0.0.1 >/dev/null 2>&1) &
http=$!
trap 'kill $http 2>/dev/null || true' EXIT
sleep 1
PLACES_DIR="$PARITY_WORK/rust/places" PLACES_PROFILE=all \
  SEARCH_OSM_DOWNLOAD_URL="http://127.0.0.1:$port/extract.osm.pbf" \
  DATABASE_URL="sqlite://$PARITY_WORK/rust/places.tmp.db?mode=rwc" JWT_SECRET="$JWT_SECRET" \
  "$RUST_BIN" places-build --force

if [ -n "${PLACE_EXTRACT_BIN:-}" ] && [ -d "$PARITY_WORK/ref/cloudflare" ]; then
  "$PLACE_EXTRACT_BIN" "$src/extract.osm.pbf" --out "$src/places.ndjson" --profile all
  (cd "$PARITY_WORK/ref/cloudflare" && bun scripts/build-place-shards.ts "$src/places.ndjson" --out public/places)
  # `next dev` answers the ASSETS binding from .open-next/assets, not from public/
  rm -rf "$PARITY_WORK/ref/cloudflare/.open-next/assets/places"
  mkdir -p "$PARITY_WORK/ref/cloudflare/.open-next/assets"
  cp -R "$PARITY_WORK/ref/cloudflare/public/places" "$PARITY_WORK/ref/cloudflare/.open-next/assets/places"
fi
rm -f "$src/extract.osm.pbf" "$src/extract.osm.pbf.md5"
