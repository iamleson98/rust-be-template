#!/usr/bin/env bash
# Run one k6 scenario with a live production-health watchdog.
# While k6 hammers the ORIGIN, this monitor keeps polling the
# production path (through Cloudflare) so any real-user impact
# is caught immediately.
#
# Usage: run_with_monitor.sh <script.js> <result-file.txt> [k6 args...]

set -u
K6=/home/z/my-project/bin/k6
SCRIPT="$1"
RESULT="$2"
shift 2

UA="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36"
MONLOG="${RESULT%.txt}.health.log"

# Watchdog: poll production /health via Cloudflare every 5s
(
  echo "timestamp http_code time_total" > "$MONLOG"
  while true; do
    ts=$(date -u +%H:%M:%S)
    line=$(curl -s --max-time 15 -A "$UA" -o /dev/null \
      -w "%{http_code} %{time_total}" "https://datxevui.com/health" 2>/dev/null || echo "ERR TIMEOUT")
    echo "$ts $line" >> "$MONLOG"
    sleep 5
  done
) &
MONPID=$!

# Local generator CPU monitor (detect sandbox-as-bottleneck)
(
  echo "timestamp loadavg" > "${RESULT%.txt}.cpu.log"
  while true; do
    echo "$(date -u +%H:%M:%S) $(cat /proc/loadavg)" >> "${RESULT%.txt}.cpu.log"
    sleep 10
  done
) &
CPUPID=$!

sleep 3 # let monitors take their first sample before load starts

K6_SUMMARY_TREND_STATS="avg,med,p(95),p(99),max" \
  "$K6" run "$@" "$SCRIPT" 2>&1 | tee "$RESULT"

kill $MONPID $CPUPID 2>/dev/null
echo ""
echo "=== Watchdog (production /health via Cloudflare, 5s interval):"
cat "$MONLOG"
echo "=== Generator CPU (loadavg):"
tail -3 "${RESULT%.txt}.cpu.log" 2>/dev/null
