#!/usr/bin/env bash
#
# run.sh — convenience runner for all k6 scenarios.
#
# Usage:
#   ./tests/k6/run.sh                    # run smoke (quick check)
#   ./tests/k6/run.sh smoke              # same as above
#   ./tests/k6/run.sh auth               # auth load test
#   ./tests/k6/run.sh chat               # chat load test
#   ./tests/k6/run.sh booking            # booking lifecycle
#   ./tests/k6/run.sh public             # public read-heavy
#   ./tests/k6/run.sh admin              # admin dashboard
#   ./tests/k6/run.sh mixed              # mixed workload
#   ./tests/k6/run.sh stress             # stress test (find breaking point)
#   ./tests/k6/run.sh all                # run all in sequence (except stress)
#
# Environment variables:
#   BASE_URL       — backend URL (default http://localhost:8080)
#   USER_EMAIL     — existing customer email (for auth/chat/booking/mixed)
#   USER_PASSWORD  — existing customer password
#   ADMIN_EMAIL    — existing employee email (for admin/mixed)
#   ADMIN_PASSWORD — existing employee password
#   TRIP_ID        — valid trip UUID (for booking with real data)
#   SEAT_ID_1      — valid seat UUID (for booking with real data)
#   K6_OUT         — output format: 'json' (writes to results/<scenario>.json) or default (text)

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCENARIO="${1:-smoke}"

# Optional JSON output — set K6_OUT=json to write results to tests/k6/results/<scenario>.json.
RESULTS_DIR="$SCRIPT_DIR/results"
mkdir -p "$RESULTS_DIR"
OUT_FLAG=""
if [[ "${K6_OUT:-}" == "json" ]]; then
  OUT_FLAG="--out json=$RESULTS_DIR/${SCENARIO}.json"
fi

run_scenario() {
  local name="$1"
  local script="$SCRIPT_DIR/scenarios/${name}.js"
  if [[ ! -f "$script" ]]; then
    echo "❌ Scenario not found: $name (looked for $script)"
    exit 1
  fi
  echo "▶️  Running k6 scenario: $name"
  echo "   Script: $script"
  echo "   BASE_URL: ${BASE_URL:-http://localhost:8080}"
  echo ""
  k6 run $OUT_FLAG "$script"
  echo ""
  echo "✅ Done: $name"
  echo ""
}

case "$SCENARIO" in
  smoke|auth|chat|booking|public|admin|mixed|stress)
    run_scenario "$SCENARIO"
    ;;
  all)
    echo "🏃 Running all scenarios (except stress) in sequence..."
    echo ""
    for s in smoke auth public chat booking admin mixed; do
      run_scenario "$s"
    done
    echo "🎉 All scenarios complete!"
    echo "   Results: $RESULTS_DIR/ (if K6_OUT=json was set)"
    ;;
  *)
    echo "❌ Unknown scenario: $SCENARIO"
    echo ""
    echo "Available scenarios:"
    echo "  smoke    — quick health check (1 VU, 1 iter)"
    echo "  auth     — register/login/refresh/logout load"
    echo "  chat     — chat channel + message load"
    echo "  booking  — booking lifecycle (hold → confirm → cancel)"
    echo "  public   — public read-heavy (homepage + search + reviews)"
    echo "  admin    — admin dashboard load"
    echo "  mixed    — mixed workload (anonymous + customers + admins)"
    echo "  stress   — stress test (ramp to 400 VUs, find breaking point)"
    echo "  all      — run all except stress in sequence"
    exit 1
    ;;
esac
