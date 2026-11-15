#!/usr/bin/env bash
# Stop what up.sh started: the process groups behind the pid files, nothing else.
. "$(dirname "${BASH_SOURCE[0]}")/env.sh"
for n in ref rust; do
  f="$PARITY_WORK/$n.pid"
  [ -f "$f" ] || continue
  pid=$(cat "$f")
  pkill -P "$pid" 2>/dev/null || true
  kill "$pid" 2>/dev/null || true
  rm -f "$f"
done
# next dev leaves a worker child listening on the port
for port in "$REF_PORT" "$RUST_PORT"; do
  pid=$(lsof -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null || true)
  [ -n "$pid" ] && kill $pid 2>/dev/null || true
done
for _ in $(seq 1 20); do
  busy=0
  for port in "$REF_PORT" "$RUST_PORT"; do lsof -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 && busy=1; done
  [ "$busy" = 0 ] && exit 0
  sleep 0.5
done
echo "ports $REF_PORT/$RUST_PORT are still in use" >&2
exit 1
