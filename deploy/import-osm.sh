#!/usr/bin/env bash
# ┌──────────────────────────────────────────────────────────────────────┐
# │ Build the Tantivy place-search index from the Vietnam OSM extract.   │
# │                                                                       │
# │ Run ON THE VPS from the deploy directory (next to the compose file): │
# │                                                                       │
# │   bash import-osm.sh                       # download (~500MB) + build │
# │   bash import-osm.sh --pbf /path/to/file   # use an existing extract  │
# │   bash import-osm.sh --threads 4 --heap 2147483648 # tune the indexer│
# │                                                                       │
# │ Flow:                                                                  │
# │   1. curl (inside the container, resumable -C -) the Geofabrik PBF   │
# │      into /app/data/vietnam-latest.osm.pbf  (app-data volume)        │
# │   2. `backend import-osm` indexes into /app/index/osm-index.staging  │
# │      and atomically renames it over /app/index/osm-index — both live │
# │      INSIDE the osm-index volume, so the rename never crosses a      │
# │      filesystem boundary (EXDEV-safe by design).                     │
# │   3. `docker compose restart backend` reopens the fresh index.       │
# │                                                                       │
# │ Hands-off alternative: leave SCHEDULER_ENABLED=true and trigger the  │
# │ `osm.import` job from the admin cron-jobs page — it downloads,       │
# │ builds, swaps, AND hot-reloads the index without a restart.          │
# └──────────────────────────────────────────────────────────────────────┘
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.contabo.yml}"
PBF=""
THREADS=""
HEAP="1073741824" # 1 GiB
URL="${SEARCH_OSM_DOWNLOAD_URL:-https://download.geofabrik.de/asia/vietnam-latest.osm.pbf}"

while [ $# -gt 0 ]; do
  case "$1" in
    --pbf)     PBF="$2"; shift 2 ;;
    --threads) THREADS="--threads $2"; shift 2 ;;
    --heap)    HEAP="$2"; shift 2 ;;
    --url)     URL="$2"; shift 2 ;;
    *) echo "unknown flag: $1 (supported: --pbf --threads --heap --url)" >&2; exit 2 ;;
  esac
done

[ -f "$COMPOSE_FILE" ] || { echo "compose file not found: $COMPOSE_FILE (run from the deploy dir)" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Backend must be running (we exec inside its container to reuse the
# image's curl + share the volumes).
if ! compose ps --status running backend 2>/dev/null | grep -q backend; then
  echo "backend container is not running — start the stack first:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d" >&2
  exit 1
fi

# ── 1. Obtain the PBF extract ───────────────────────────────────────────
if [ -n "$PBF" ]; then
  echo "▶ using local PBF: $PBF"
  compose cp "$PBF" backend:/app/data/vietnam-latest.osm.pbf
else
  echo "▶ downloading $URL (resumable)"
  compose exec -T backend sh -c "
    set -e
    mkdir -p /app/data
    curl -fL --retry 5 --retry-delay 10 -C - -o /app/data/vietnam-latest.osm.pbf '$URL'
    ls -lh /app/data/vietnam-latest.osm.pbf
  "
fi

# ── 2. Index into staging + atomic swap ─────────────────────────────────
echo "▶ building Tantivy index (heap=$HEAP ${THREADS:-auto threads})"
compose exec -T backend /app/backend import-osm \
  /app/data/vietnam-latest.osm.pbf \
  --index-dir /app/index/osm-index \
  --heap-bytes "$HEAP" $THREADS

# ── 3. Reload: the CLI import swaps files on disk, but the running
#    server holds the OLD reader open — restart reopens the new index.
echo "▶ restarting backend to pick up the fresh index"
compose restart backend

echo "▶ waiting for health"
for i in $(seq 1 30); do
  if compose exec -T backend curl -sf http://localhost:8080/health >/dev/null 2>&1; then
    echo "✔ done — place search is live (try /api/places/search?q=ha noi)"
    exit 0
  fi
  sleep 2
done
echo "⚠ backend not healthy after 60s — check: docker compose -f $COMPOSE_FILE logs --tail 50 backend" >&2
exit 1
