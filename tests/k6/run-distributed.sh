#!/usr/bin/env bash
#
# run-distributed.sh — run k6 load tests across N Docker containers,
# each with its own IP (separate rate-limit buckets).
#
# This is the "distributed IP" approach for load testing — each
# container appears as a different source IP to the backend, so the
# rate limiter (600 RPM / 100 burst per IP) gives each container its
# own bucket. With N containers you get N× the aggregate throughput.
#
# ## Usage
#
#   # Run 3 workers with the public scenario (default 5 workers):
#   ./tests/k6/run-distributed.sh public 3
#
#   # Run 5 workers with the mixed scenario + JSON output:
#   K6_OUT=json ./tests/k6/run-distributed.sh mixed 5
#
#   # Run against a backend on the host (cargo run):
#   BASE_URL=http://host.docker.internal:8080 \
#     ./tests/k6/run-distributed.sh auth 5
#
# ## Arguments
#
#   $1 — scenario name (smoke, auth, chat, booking, public, admin, mixed, stress)
#        default: smoke
#   $2 — number of workers (1-10)
#        default: 5
#
# ## Environment variables
#
#   BASE_URL       — backend URL (default http://host.docker.internal:8080)
#   ORIGIN         — Origin header value (default http://localhost:8080)
#   USER_EMAIL     — existing customer email (for auth/chat/booking/mixed)
#   USER_PASSWORD  — existing customer password
#   ADMIN_EMAIL    — existing employee email (for admin/mixed)
#   ADMIN_PASSWORD — existing employee password
#   TRIP_ID        — valid trip UUID (for booking)
#   SEAT_ID_1      — valid seat UUID
#   K6_OUT         — output format: 'json' (writes per-worker JSON) or default (text)

set -euo pipefail

SCENARIO="${1:-smoke}"
WORKERS="${2:-5}"

# Validate args.
if [[ "$WORKERS" -lt 1 || "$WORKERS" -gt 10 ]]; then
  echo "❌ Workers must be between 1 and 10 (got $WORKERS)"
  exit 1
fi

VALID_SCENARIOS="smoke auth chat booking public admin mixed stress"
if ! echo "$VALID_SCENARIOS" | grep -qw "$SCENARIO"; then
  echo "❌ Unknown scenario: $SCENARIO"
  echo "   Valid: $VALID_SCENARIOS"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"

# Backend URL — default to host.docker.internal so it works when the
# backend runs on the host via `cargo run`. If the backend is in Docker
# (via docker-compose.yml), set BASE_URL=http://backend:8080.
BASE_URL="${BASE_URL:-http://host.docker.internal:8080}"
ORIGIN="${ORIGIN:-http://localhost:8080}"

# K6 image — pinned for reproducibility.
K6_IMAGE="grafana/k6:0.57.0"

# Map scenario name to filename (01-smoke.js → smoke, etc.).
case "$SCENARIO" in
  smoke)   SCRIPT_FILE="01-smoke.js" ;;
  auth)    SCRIPT_FILE="02-auth.js" ;;
  chat)    SCRIPT_FILE="03-chat.js" ;;
  booking) SCRIPT_FILE="04-booking.js" ;;
  public)  SCRIPT_FILE="05-public.js" ;;
  admin)   SCRIPT_FILE="06-admin.js" ;;
  mixed)   SCRIPT_FILE="07-mixed.js" ;;
  stress)  SCRIPT_FILE="08-stress.js" ;;
esac

echo "🚀 Distributed k6 load test"
echo "   Scenario: $SCENARIO ($SCRIPT_FILE)"
echo "   Workers:  $WORKERS"
echo "   Backend:  $BASE_URL"
echo "   Image:    $K6_IMAGE"
echo ""

# Build the env var list — passed to every worker container.
ENV_ARGS=(
  -e "K6_NO_SYSTEM_PROXY=true"
  -e "BASE_URL=$BASE_URL"
  -e "ORIGIN=$ORIGIN"
  -e "USER_EMAIL=${USER_EMAIL:-}"
  -e "USER_PASSWORD=${USER_PASSWORD:-}"
  -e "ADMIN_EMAIL=${ADMIN_EMAIL:-}"
  -e "ADMIN_PASSWORD=${ADMIN_PASSWORD:-}"
  -e "TRIP_ID=${TRIP_ID:-}"
  -e "SEAT_ID_1=${SEAT_ID_1:-}"
  -e "SEAT_ID_2=${SEAT_ID_2:-}"
)

# Output format — default to text (stdout). Set K6_OUT=json for CI.
OUT_FLAG=""
if [[ "${K6_OUT:-}" == "json" ]]; then
  OUT_FLAG="--out=json=/results/worker-${i}.json"
fi

# Start each worker container in the background.
WORKER_PIDS=()
for i in $(seq 1 "$WORKERS"); do
  OFFSET=$(( (i - 1) * 1000 ))
  CONTAINER_NAME="k6-worker-${i}-$$"

  echo "▶️  Starting worker $i (VU offset: $OFFSET, container: $CONTAINER_NAME)"

  # Run k6 in a detached container. Each container gets its own IP
  # on the default Docker bridge → separate rate-limit bucket.
  docker run \
    --rm \
    --name "$CONTAINER_NAME" \
    -v "$PROJECT_ROOT/tests/k6:/scripts:ro" \
    -v "$RESULTS_DIR:/results" \
    "${ENV_ARGS[@]}" \
    -e "K6_VU_OFFSET=$OFFSET" \
    "$K6_IMAGE" \
    run $OUT_FLAG "/scripts/scenarios/${SCRIPT_FILE}" \
    > "$RESULTS_DIR/worker-${i}.log" 2>&1 &

  WORKER_PIDS+=($!)
done

echo ""
echo "⏳ All $WORKERS workers started. Waiting for completion..."
echo "   Logs: $RESULTS_DIR/worker-*.log"
echo ""

# Wait for all workers to finish.
FAILED=0
for i in "${!WORKER_PIDS[@]}"; do
  WORKER_NUM=$((i + 1))
  PID="${WORKER_PIDS[$i]}"
  if wait "$PID"; then
    echo "✅ Worker $WORKER_NUM completed"
  else
    echo "❌ Worker $WORKER_NUM failed (exit code $?)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""

# Aggregate results if JSON output was requested.
if [[ "${K6_OUT:-}" == "json" ]]; then
  echo "📊 Aggregating results from $RESULTS_DIR/worker-*.json..."
  AGG_FILE="$RESULTS_DIR/aggregate-$SCENARIO-$(date +%Y%m%d-%H%M%S).json"

  # Merge all worker JSON files into one + compute aggregate metrics.
  # Each worker's JSON is newline-delimited (NDJSON) — one event per line.
  # We concatenate them + tag each line with the worker number.
  for i in $(seq 1 "$WORKERS"); do
    WORKER_FILE="$RESULTS_DIR/worker-${i}.json"
    if [[ -f "$WORKER_FILE" ]]; then
      # Tag each line with the worker number so we can distinguish them.
      jq -c --arg worker "worker-$i" '. + {worker: $worker}' "$WORKER_FILE" >> "$AGG_FILE" 2>/dev/null || true
    fi
  done

  if [[ -f "$AGG_FILE" ]]; then
    echo "   Aggregate: $AGG_FILE"
    # Print summary metrics from the aggregate.
    echo ""
    echo "   ── Aggregate summary ──"
    # Extract metrics from the NDJSON. Each worker outputs a "point" line
    # per metric per iteration. We sum the counts + compute averages.
    jq -s '
      group_by(.metric) | map({
        metric: .[0].metric,
        count: length,
        sum: (map(.data.value // 0) | add),
        avg: (map(.data.value // 0) | add / length),
        min: (map(.data.value // 0) | min),
        max: (map(.data.value // 0) | max),
      })
    ' "$AGG_FILE" 2>/dev/null | head -50 || echo "   (install jq for aggregation)"
  fi
fi

echo ""
if [[ "$FAILED" -gt 0 ]]; then
  echo "⚠️  $FAILED worker(s) failed. Check logs: $RESULTS_DIR/worker-*.log"
  exit 1
else
  echo "🎉 All $WORKERS workers completed successfully."
  echo "   Per-worker logs: $RESULTS_DIR/worker-*.log"
  if [[ "${K6_OUT:-}" == "json" ]]; then
    echo "   Per-worker JSON: $RESULTS_DIR/worker-*.json"
  fi
fi
