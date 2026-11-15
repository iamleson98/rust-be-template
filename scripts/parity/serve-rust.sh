#!/usr/bin/env bash
# Import the stage database (`backend import-d1`) and start the Rust server on the
# result. STATIC_FILES_DIR (the built frontend/dist) and PLACES_DIR (a generation from
# build-places.sh) are used when they exist.
set -euo pipefail
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
[ -f "$PARITY_WORK/stage.db" ] || "$(dirname "${BASH_SOURCE[0]}")/stage.sh"
rust="$PARITY_WORK/rust"
rm -rf "$rust/app.db"* "$rust/storage"
mkdir -p "$rust/storage" "$rust/places"
"$RUST_BIN" import-d1 --stage "$PARITY_WORK/stage.db" --out "$rust/app.db" --report "$rust/report.json"
export DATABASE_URL="sqlite://$rust/app.db?mode=rwc"
export JWT_SECRET COOKIE_SECURE=false COOKIE_DOMAIN=localhost CACHE_BACKEND=moka WORKER_BACKEND=db
export SCHEDULER_ENABLED=false NULLCLAW_ENABLED=false AUDIO_CALL_ENABLED=true
export SERVER_HOST=127.0.0.1 SERVER_PORT="$RUST_PORT"
export STORAGE_BACKEND=local STORAGE_LOCAL_ROOT="$rust/storage"
export PLACES_DIR="${PLACES_DIR:-$rust/places}"
export STATIC_FILES_DIR="${STATIC_FILES_DIR:-$ROOT/frontend/dist}"
export CORS_ORIGINS="http://localhost:$RUST_PORT,http://127.0.0.1:$RUST_PORT"
export PAYMENT_PUBLIC_BASE_URL="http://localhost:$RUST_PORT"
export VNPAY_ENABLED=false MOMO_ENABLED=false ZALOPAY_ENABLED=false
export VIETQR_ENABLED=true VIETQR_BANK_BIN=970436 VIETQR_ACCOUNT_NO=0123456789 VIETQR_ACCOUNT_NAME="DAT XE VUI"
export PAYMENT_COD_ENABLED=true
export OAUTH_GOOGLE_ENABLED=false OAUTH_FACEBOOK_ENABLED=false
# One client IP fires hundreds of requests: lift the per-IP limits (the REF's local bindings enforce none).
export RATE_LIMIT_RPM=1000000 RATE_LIMIT_BURST=1000000 RATE_LIMIT_STRICT_RPM=1000000 RATE_LIMIT_AUTH_PER_MIN=1000000 RATE_LIMIT_WRITE_PER_MIN=1000000
exec "$RUST_BIN"
