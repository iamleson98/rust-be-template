#!/usr/bin/env bash
# Start both servers in the background (logs and pid files in $PARITY_WORK) and wait until
# they answer. Stop them with down.sh. A fresh stage and a fresh import every time.
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
. "$here/env.sh"
mkdir -p "$PARITY_WORK"
"$here/down.sh"
"$here/stage.sh"
nohup "$here/serve-ref.sh" >"$PARITY_WORK/ref.log" 2>&1 &
echo $! >"$PARITY_WORK/ref.pid"
nohup "$here/serve-rust.sh" >"$PARITY_WORK/rust.log" 2>&1 &
echo $! >"$PARITY_WORK/rust.pid"
wait_for() { # url, label
  for _ in $(seq 1 120); do
    if curl -fs -m 5 -A "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36" "$1" >/dev/null 2>&1; then echo "$2 up"; return 0; fi
    sleep 2
  done
  echo "$2 did not come up; see $PARITY_WORK/*.log" >&2
  return 1
}
wait_for "http://localhost:$RUST_PORT/api/brands" rust
wait_for "http://localhost:$REF_PORT/api/brands" ref
