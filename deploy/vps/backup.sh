#!/usr/bin/env bash
# datxevui-backup [--local-only] — consistent hot backup of the SQLite database.
#
# Installed as /usr/local/sbin/datxevui-backup and run every 6 hours by
# datxevui-backup.timer (as user datxevui, settings from /etc/datxevui/env).
# datxevui-update runs it with --local-only before swapping a release.
#
#   1. VACUUM INTO a snapshot. It is one read transaction, so it is a
#      consistent image while the site keeps writing, and the copy has no WAL
#      to carry around. (Never `cp` app.db: it would miss app.db-wal.)
#   2. integrity_check the snapshot; a bad one is deleted and the run fails.
#   3. gzip to /var/lib/datxevui/backups/app-<UTC stamp>.db.gz and keep the
#      newest BACKUP_KEEP_LOCAL.
#   4. Unless --local-only or BACKUP_S3_BUCKET is empty: copy the archive to
#      s3://<bucket>/<prefix>/db/, copy uploads/ to s3://<bucket>/<prefix>/uploads/
#      (add-only: nothing is deleted remotely), and delete remote database
#      archives older than BACKUP_KEEP_REMOTE_DAYS.
#
# The app checkpoints the WAL itself (PASSIVE every 60 s, TRUNCATE nightly at
# 04:00), so nothing here touches the WAL. Restore:
#   systemctl stop datxevui
#   gunzip -c app-<stamp>.db.gz > /var/lib/datxevui/app.db
#   rm -f /var/lib/datxevui/app.db-wal /var/lib/datxevui/app.db-shm
#   chown datxevui:datxevui /var/lib/datxevui/app.db && systemctl start datxevui
set -euo pipefail
umask 077

db="${DB_PATH:-/var/lib/datxevui/app.db}"
dir="${BACKUP_DIR:-/var/lib/datxevui/backups}"
uploads="${STORAGE_LOCAL_ROOT:-/var/lib/datxevui/uploads}"
keep_local="${BACKUP_KEEP_LOCAL:-8}"
keep_remote_days="${BACKUP_KEEP_REMOTE_DAYS:-30}"
bucket="${BACKUP_S3_BUCKET:-}"
prefix="${BACKUP_S3_PREFIX:-datxevui}"

local_only=false
case "${1:-}" in
  "") ;;
  --local-only) local_only=true ;;
  *) echo "usage: datxevui-backup [--local-only]" >&2; exit 2 ;;
esac

[ -f "$db" ] || { echo "no database at $db" >&2; exit 1; }
install -d -m 0700 "$dir"

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
snap="$dir/.app-$stamp.db"
archive="$dir/app-$stamp.db.gz"
trap 'rm -f "$snap" "$archive.part"' EXIT

echo "==> VACUUM INTO $snap"
sqlite3 -bail "$db" ".timeout 30000" "VACUUM INTO '$snap'"
check="$(sqlite3 "$snap" "PRAGMA integrity_check;")"
if [ "$check" != ok ]; then
  echo "snapshot failed integrity_check: $check" >&2
  exit 1
fi

gzip -6 -c "$snap" > "$archive.part"
mv "$archive.part" "$archive"
echo "==> $archive ($(stat -c%s "$archive") bytes)"

# Newest first; the timestamps sort lexically.
find "$dir" -maxdepth 1 -name 'app-*.db.gz' | sort -r | tail -n +$((keep_local + 1)) \
  | while IFS= read -r old; do rm -f -- "$old"; done
date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/.last-ok"

if $local_only || [ -z "$bucket" ]; then
  exit 0
fi

command -v rclone >/dev/null || { echo "rclone is not installed (bootstrap.sh installs it)" >&2; exit 1; }
# An S3 remote built from the environment: no config file, and the keys never
# appear on a command line.
export RCLONE_CONFIG=/dev/null
export RCLONE_S3_PROVIDER=Other
export RCLONE_S3_ENV_AUTH=false
export RCLONE_S3_ACCESS_KEY_ID="${BACKUP_S3_ACCESS_KEY_ID:?BACKUP_S3_ACCESS_KEY_ID is empty}"
export RCLONE_S3_SECRET_ACCESS_KEY="${BACKUP_S3_SECRET_ACCESS_KEY:?BACKUP_S3_SECRET_ACCESS_KEY is empty}"
export RCLONE_S3_REGION="${BACKUP_S3_REGION:-us-east-1}"
if [ -n "${BACKUP_S3_ENDPOINT:-}" ]; then
  export RCLONE_S3_ENDPOINT="$BACKUP_S3_ENDPOINT"
  # RustFS and MinIO have no bucket-name subdomains.
  export RCLONE_S3_FORCE_PATH_STYLE=true
fi
remote=":s3:$bucket/$prefix"

echo "==> upload to $remote/db/"
rclone copyto "$archive" "$remote/db/$(basename "$archive")"
if [ -d "$uploads" ]; then
  echo "==> sync uploads to $remote/uploads/ (add-only)"
  rclone copy --transfers 4 "$uploads" "$remote/uploads"
fi
echo "==> prune remote archives older than ${keep_remote_days}d"
rclone delete --min-age "${keep_remote_days}d" --include 'app-*.db.gz' "$remote/db"
date -u +%Y-%m-%dT%H:%M:%SZ > "$dir/.last-upload-ok"
