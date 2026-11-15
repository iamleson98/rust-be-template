#!/usr/bin/env bash
# r2-sync.sh — copy the Worker's R2 bucket to the VPS uploads directory.
#
#   scripts/r2-sync.sh [--bucket datxevui-uploads] [--dest /var/lib/datxevui/uploads]
#                      [--check-db /var/lib/datxevui/app.db] [--check-only] [--dry-run]
#
# Keys become relative paths under --dest, unchanged, which is how the app's
# local storage (STORAGE_LOCAL_ROOT) addresses objects:
#
#   routes/{route uuid}/{16 hex}.webp          route picture
#   routes/{route uuid}/t{16 hex}.webp         its thumbnail
#   brands/logos/{16 hex}.webp | .svg          brand logo
#   (older routes/... .jpg / .png keys are copied and still served)
#
# Keys are content-addressed (the hash is in the name), so an object that is
# already there with the same size is the same object: the copy is cheap to
# repeat. Run it a day ahead to move the bulk, and again at cutover for the
# delta. Nothing is ever deleted from --dest.
#
# Credentials come from the environment, never the command line (an R2 API
# token with read access to the bucket):
#   R2_ACCOUNT_ID  R2_ACCESS_KEY_ID  R2_SECRET_ACCESS_KEY
# Uses rclone when installed, else the aws CLI. After the copy it verifies
# that nothing is left to copy. With --check-db it also proves that every
# object the database points at (route pictures and thumbnails, brand logos)
# exists under --dest; --check-only does just that, with no transfer and no
# credentials. Files are written as the invoking user: give them to the
# service user afterwards (chown -R datxevui: DEST).
set -euo pipefail

usage() {
  echo "usage: r2-sync.sh [--bucket NAME] [--dest DIR] [--check-db app.db] [--check-only] [--dry-run]" >&2
  exit 2
}

bucket="datxevui-uploads"
dest="/var/lib/datxevui/uploads"
check_db=""
check_only=false
dry_run=false
while [ $# -gt 0 ]; do
  case "$1" in
    --bucket) bucket="${2:?--bucket needs a value}"; shift 2 ;;
    --dest) dest="${2:?--dest needs a value}"; shift 2 ;;
    --check-db) check_db="${2:?--check-db needs a value}"; shift 2 ;;
    --check-only) check_only=true; shift ;;
    --dry-run) dry_run=true; shift ;;
    *) usage ;;
  esac
done
case "$dest" in
  "" | "/") echo "refusing --dest '$dest'" >&2; exit 2 ;;
esac
if $check_only && [ -z "$check_db" ]; then
  echo "--check-only needs --check-db" >&2
  exit 2
fi

transfer() {
  local account="${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is empty}"
  local key_id="${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is empty}"
  local secret="${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is empty}"
  local endpoint="https://$account.r2.cloudflarestorage.com"
  mkdir -p "$dest"

  if command -v rclone > /dev/null; then
    # An S3 remote built from the environment: no config file, and the keys
    # never appear on a command line.
    export RCLONE_CONFIG=/dev/null
    export RCLONE_S3_PROVIDER=Cloudflare
    export RCLONE_S3_ENV_AUTH=false
    export RCLONE_S3_ACCESS_KEY_ID="$key_id"
    export RCLONE_S3_SECRET_ACCESS_KEY="$secret"
    export RCLONE_S3_ENDPOINT="$endpoint"
    export RCLONE_S3_REGION=auto
    export RCLONE_S3_NO_CHECK_BUCKET=true
    local source=":s3:$bucket"
    echo "==> rclone copy $bucket -> $dest"
    if $dry_run; then
      rclone copy --dry-run --size-only --transfers 8 "$source" "$dest"
      return
    fi
    rclone copy --size-only --transfers 8 "$source" "$dest"
    echo "==> verify: every object of the bucket is here with the same size"
    rclone check --one-way --size-only "$source" "$dest"
    echo "bucket:"; rclone size "$source"
    echo "dest:"; rclone size "$dest"
  elif command -v aws > /dev/null; then
    export AWS_ACCESS_KEY_ID="$key_id"
    export AWS_SECRET_ACCESS_KEY="$secret"
    export AWS_DEFAULT_REGION=auto
    local source="s3://$bucket"
    echo "==> aws s3 sync $bucket -> $dest"
    if $dry_run; then
      aws s3 sync --dryrun --size-only --endpoint-url "$endpoint" "$source" "$dest"
      return
    fi
    aws s3 sync --size-only --endpoint-url "$endpoint" "$source" "$dest"
    echo "==> verify: nothing is left to copy"
    local left
    left="$(aws s3 sync --dryrun --size-only --endpoint-url "$endpoint" "$source" "$dest")"
    if [ -n "$left" ]; then
      echo "$left" >&2
      echo "objects are still missing from $dest" >&2
      exit 1
    fi
  else
    echo "neither rclone nor the aws CLI is installed" >&2
    exit 1
  fi
}

# Every object key the database refers to: route pictures, their thumbnails,
# brand logos stored as /api/media/{key}.
check_keys() {
  command -v sqlite3 > /dev/null || { echo "the sqlite3 CLI is not installed" >&2; exit 1; }
  [ -f "$check_db" ] || { echo "no database at $check_db" >&2; exit 1; }
  local keys missing=0 total=0 key
  keys="$(sqlite3 "$check_db" "
    SELECT storage_key FROM route_picture
    UNION SELECT thumb_key FROM route_picture
    UNION SELECT substr(logo_url, length('/api/media/') + 1) FROM brand WHERE logo_url LIKE '/api/media/%'")"
  while IFS= read -r key; do
    [ -n "$key" ] || continue
    total=$((total + 1))
    if [ ! -f "$dest/$key" ]; then
      echo "missing: $key" >&2
      missing=$((missing + 1))
    fi
  done <<< "$keys"
  echo "==> $total object(s) referenced by $check_db, $missing missing from $dest"
  [ "$missing" -eq 0 ]
}

if ! $check_only; then
  transfer
fi
if [ -n "$check_db" ] && ! $dry_run; then
  check_keys
fi
