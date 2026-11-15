#!/usr/bin/env bash
# Start the Cloudflare reference locally: `next dev` with wrangler's local bindings
# (miniflare D1/KV/R2 in .wrangler/state). Nothing here talks to Cloudflare:
# remoteBindings is off in next.config.ts and no account is logged in.
#
# The reference is copied (never edited in place) to $PARITY_WORK/ref, its
# dependencies installed there with bun, and its local D1 file replaced by the
# stage database. A place index built by build-places.sh is served from
# public/places when present.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
ref="$PARITY_WORK/ref/cloudflare"
[ -f "$PARITY_WORK/stage.db" ] || "$(dirname "${BASH_SOURCE[0]}")/stage.sh"
if [ ! -d "$ref" ]; then
  mkdir -p "$PARITY_WORK/ref"
  cp -R "$REF_SRC/cloudflare" "$PARITY_WORK/ref/"
fi
cd "$ref"
[ -d node_modules ] || bun install --frozen-lockfile
cat > .dev.vars <<VARS
JWT_SECRET=$JWT_SECRET
APP_ENV=development
COOKIE_SAMESITE=lax
PAYMENT_PUBLIC_BASE_URL=http://localhost:$REF_PORT
CRON_SERVICE_TOKEN=local-cron
VIETQR_ENABLED=true
VIETQR_BANK_BIN=970436
VIETQR_ACCOUNT_NO=0123456789
VIETQR_ACCOUNT_NAME=DAT XE VUI
PAYMENT_COD_ENABLED=true
VARS
export WRANGLER_SEND_METRICS=false NEXT_TELEMETRY_DISABLED=1 CI=1
export PLACES_DEV_ORIGIN="http://localhost:$REF_PORT"
# A fresh local D1: let wrangler create its file, then replace it with the stage.
rm -rf .wrangler
./node_modules/.bin/wrangler d1 execute DB --local --command "select 1" >/dev/null
d1=$(find .wrangler/state/v3/d1/miniflare-D1DatabaseObject -name '*.sqlite' ! -name metadata.sqlite | head -1)
rm -f "$d1" "$d1-wal" "$d1-shm"
cp "$PARITY_WORK/stage.db" "$d1"
exec ./node_modules/.bin/next dev -p "$REF_PORT"
