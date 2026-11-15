#!/usr/bin/env bash
# The Worker's own integration scripts (cloudflare/scripts: contract-sweep, ws-smoke, chat-flow,
# call-hub) against the Rust server. They expect a fresh database whose first account (the admin)
# is admin@example.com / change-me, and a server on :3000 (ws-smoke hard-codes ws://localhost:3000).
# Their fetch() sends node's User-Agent and no Origin, which the Rust anti-scraping layer refuses
# by design: ref-scripts/browser-ua.mjs (node --import) makes them present as a browser; the
# scripts themselves are untouched.
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$here/env.sh"
port=3000
scripts="$PARITY_WORK/ref/cloudflare/scripts"
[ -d "$scripts" ] || { echo "run serve-ref.sh once first: it copies the reference to $PARITY_WORK/ref" >&2; exit 1; }
if lsof -iTCP:$port -sTCP:LISTEN >/dev/null 2>&1; then echo "port $port is in use" >&2; exit 1; fi

work="$PARITY_WORK/ref-scripts"
rm -rf "$work" && mkdir -p "$work/storage"
(
  export DATABASE_URL="sqlite://$work/app.db?mode=rwc" JWT_SECRET COOKIE_SECURE=false COOKIE_DOMAIN=localhost
  export CACHE_BACKEND=moka WORKER_BACKEND=db SCHEDULER_ENABLED=false NULLCLAW_ENABLED=false AUDIO_CALL_ENABLED=true
  export SERVER_HOST=127.0.0.1 SERVER_PORT=$port STORAGE_BACKEND=local STORAGE_LOCAL_ROOT="$work/storage"
  export PLACES_DIR="$PARITY_WORK/rust/places" STATIC_FILES_DIR="$ROOT/frontend/dist"
  export CORS_ORIGINS="http://localhost:$port" PAYMENT_PUBLIC_BASE_URL="http://localhost:$port"
  export RATE_LIMIT_RPM=1000000 RATE_LIMIT_BURST=1000000 RATE_LIMIT_STRICT_RPM=1000000 RATE_LIMIT_AUTH_PER_MIN=1000000 RATE_LIMIT_WRITE_PER_MIN=1000000
  export VNPAY_ENABLED=false MOMO_ENABLED=false ZALOPAY_ENABLED=false VIETQR_ENABLED=false
  exec "$RUST_BIN" >"$work/server.log" 2>&1
) &
server=$!
trap 'kill $server 2>/dev/null || true' EXIT
ua="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
for _ in $(seq 1 60); do curl -fs -A "$ua" "http://localhost:$port/api/brands" >/dev/null 2>&1 && break; sleep 1; done
# the first human account becomes the admin
curl -fs -A "$ua" -H "Origin: http://localhost:$port" -H 'content-type: application/json' \
  -d '{"email":"admin@example.com","password":"change-me","fullName":"Admin"}' \
  "http://localhost:$port/api/auth/register" >/dev/null

status=0
for s in ${ONLY:-contract-sweep ws-smoke chat-flow call-hub}; do
  echo "=== $s"
  # Node resolves `ws` from the script's own folder (the REF copy's node_modules). A script that
  # waits for a frame that never comes is killed after two minutes.
  (cd "$scripts" && TEST_BASE_URL="http://localhost:$port" REF_WS_MODULE="$scripts/package.json" exec node --import "$here/ref-scripts/browser-ua.mjs" "$s-test.mjs") &
  job=$!
  ( sleep 120; kill "$job" 2>/dev/null ) &
  dog=$!
  if wait "$job"; then
    echo "--- $s: PASS"
  else
    echo "--- $s: FAIL"
    status=1
  fi
  kill "$dog" 2>/dev/null || true
done
exit $status
