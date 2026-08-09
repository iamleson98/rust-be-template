#!/usr/bin/env bash
# download-vietnam-osm.sh — download the latest Vietnam OSM PBF extract from
# Geofabrik and place it at the path the importer expects.
#
# Usage:
#   ./scripts/download-vietnam-osm.sh [output-path]
#
# Default output path: ./data/vietnam-latest.osm.pbf
#
# The file is ~500 MB; download takes 1-5 min depending on bandwidth.
# Geofabrik republishes the extract daily, so re-running this script
# keeps the PBF (and therefore the Tantivy place index) up to date.
set -euo pipefail

GEOFABRIK_URL="https://download.geofabrik.de/asia/vietnam-latest.osm.pbf"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

OUTPUT="${1:-$PROJECT_ROOT/data/vietnam-latest.osm.pbf}"
mkdir -p "$(dirname "$OUTPUT")"

echo "→ Downloading Vietnam OSM PBF from Geofabrik…"
echo "  URL: $GEOFABRIK_URL"
echo "  Output: $OUTPUT"

# Use curl if available, fall back to wget.
if command -v curl >/dev/null 2>&1; then
    curl -L --fail --progress-bar -o "$OUTPUT.tmp" "$GEOFABRIK_URL"
elif command -v wget >/dev/null 2>&1; then
    wget --progress=bar -O "$OUTPUT.tmp" "$GEOFABRIK_URL"
else
    echo "✗ Neither curl nor wget is installed. Install one and retry." >&2
    exit 1
fi

mv "$OUTPUT.tmp" "$OUTPUT"

# Sanity: file size should be > 100 MB (Vietnam extract is ~500 MB).
SIZE=$(stat -c%s "$OUTPUT" 2>/dev/null || stat -f%z "$OUTPUT")
if [ "$SIZE" -lt 104857600 ]; then
    echo "✗ Downloaded file is only $SIZE bytes — aborting (expected >100 MB)." >&2
    exit 1
fi

echo "✓ Downloaded $((SIZE / 1024 / 1024)) MB to $OUTPUT"
echo ""
echo "Next step: build the Tantivy place index:"
echo "  cargo run --release -- import-osm $OUTPUT"
echo "  # or, with the prebuilt binary:"
echo "  ./vexevn-backend import-osm $OUTPUT"
