#!/usr/bin/env bash
# ┌──────────────────────────────────────────────────────────────────────┐
# │ Build a place-search generation from the Vietnam OSM extract.        │
# │                                                                       │
# │ Run ON THE VPS from the deploy directory (next to the compose file): │
# │                                                                       │
# │   bash places-build.sh            # download, build, publish         │
# │   bash places-build.sh --force    # rebuild even if the extract is   │
# │                                   # unchanged                         │
# │                                                                       │
# │ `backend places-build` (inside the running container):               │
# │   1. skips everything when Geofabrik's MD5 matches the live          │
# │      generation (unless --force);                                     │
# │   2. streams the extract (~500 MB) into PLACES_DIR/work, checks its  │
# │      MD5, builds gen-<ts>/records.bin and validates it;               │
# │   3. flips the `current` symlink to the new generation.               │
# │                                                                       │
# │ The server polls `current` and swaps the engine in memory: no        │
# │ restart. A failed build leaves the live generation untouched.        │
# │ Set SEARCH_OSM_DOWNLOAD_URL in .env to use a mirror.                  │
# └──────────────────────────────────────────────────────────────────────┘
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.contabo.yml}"
FLAGS=()

while [ $# -gt 0 ]; do
  case "$1" in
    --force) FLAGS+=(--force); shift ;;
    *) echo "unknown flag: $1 (supported: --force)" >&2; exit 2 ;;
  esac
done

[ -f "$COMPOSE_FILE" ] || { echo "compose file not found: $COMPOSE_FILE (run from the deploy dir)" >&2; exit 1; }
compose() { docker compose -f "$COMPOSE_FILE" "$@"; }

# Backend must be running (we exec inside its container to share the
# volumes and its environment).
if ! compose ps --status running backend 2>/dev/null | grep -q backend; then
  echo "backend container is not running — start the stack first:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d" >&2
  exit 1
fi

echo "▶ building the place index"
compose exec -T backend /app/backend places-build ${FLAGS[@]+"${FLAGS[@]}"}
echo "✔ done — the server picks the new generation up within a minute"
