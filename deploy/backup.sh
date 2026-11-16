#!/usr/bin/env bash
# backup.sh — consistent hot backup of the datxevui stack's state.
#
# WHY THIS SHAPE: one pause-and-copy pattern for every volume:
#
#   * backend volume (app.db + app.db-wal): `docker pause` the backend
#     (cgroup freezer — in-flight syscalls complete, scheduling stops),
#     copy the files at that instant, then unpause. The image is
#     exactly a crash-state snapshot: SQLite's WAL recovery on restore
#     rolls it to a consistent point. Pause lasts only the local-disk
#     copy of the data volume (~seconds on this node).
#   * rustfs volume (route pictures / thumbnails): same pause-copy
#     pattern against the rustfs container.
#   * place index volume: SKIPPED — rebuildable from the OSM extract via
#     the `places.build` job; backing it up would
#     double the archive size for no data value.
#
# Result: <output_dir>/datxevui-backup-YYYYmmdd-HHMMSS.tar.gz
#         (contains data/app.db[+wal] and rustfs objects)
#
# Recommended cron (daily 04:30 — offset from pdf-tts's 04:00 so the
# two backups never compete for disk/CPU; keep 7 days):
#   30 4 * * * bash /opt/vexevn/backup.sh /var/backups/datxevui && \
#     find /var/backups/datxevui -name '*.tar.gz' -mtime +7 -delete
set -euo pipefail

BACKUP_DIR="${1:-/var/backups/datxevui}"
STACK_NAME="${STACK_NAME:-datxevui}"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$BACKUP_DIR/datxevui-backup-$STAMP.tar.gz"
SNAP_DIR="$(mktemp -d)"
trap 'rm -rf "$SNAP_DIR"' EXIT

mkdir -p "$BACKUP_DIR"

# copy_volume <service> <volume-name> <dest-dir>
# Pause the service's running task (if any), copy the volume, unpause.
# The UNPAUSE trap guarantees the service never stays frozen on error.
copy_volume() {
  local service="$1" volume="$2" dest="$3"
  local cid paused="no"
  cid=$(docker ps -q --filter "name=${service}" | head -n1 || true)
  if [ -n "$cid" ]; then
    if docker pause "$cid" >/dev/null 2>&1; then
      paused="yes"
      trap '[ -n "'"$cid"'" ] && docker unpause '"$cid"' >/dev/null 2>&1 || true' RETURN
    fi
  fi
  mkdir -p "$dest"
  # Copy on the HOST (volume files are directly readable as root).
  cp -a "/var/lib/docker/volumes/${volume}/_data/." "$dest/"
  if [ "$paused" = "yes" ]; then
    docker unpause "$cid" >/dev/null 2>&1 || true
  fi
}

echo "==> Snapshotting backend DB volume (app briefly paused, crash-consistent WAL image)…"
copy_volume "${STACK_NAME}_backend" "${STACK_NAME}_vexevn-data" "$SNAP_DIR/data"

echo "==> Snapshotting rustfs object volume (rustfs briefly paused)…"
copy_volume "${STACK_NAME}_rustfs" "${STACK_NAME}_rustfs-data" "$SNAP_DIR/rustfs"

echo "==> Archiving → $OUT"
tar czf "$OUT" -C "$SNAP_DIR" data rustfs

size="$(stat -c%s "$OUT" 2>/dev/null || stat -f%z "$OUT")"
if [ "$size" -lt 1000000 ]; then
  echo "WARNING: backup is only $size bytes — inspect $OUT before trusting it." >&2
  exit 1
fi
echo "==> done: $OUT ($(( size / 1024 / 1024 ))) MiB"
