#!/usr/bin/env bash
# Wait until the production site runs the given release, as release-vps.yml's
# last step. The VPS installs a published release by itself (datxevui-update
# .timer, every 5 minutes), so this only watches: it polls /ready, whose
# `version` is the tag the running binary was built from.
#
#   verify-release.sh v1.2.3
#
# Environment (all optional):
#   READY_URL        default https://datxevui.com/ready
#   VERIFY_TIMEOUT   seconds to wait in total, default 900
#   VERIFY_INTERVAL  seconds between polls, default 20
#
# Exit status: 0 once /ready reports the tag, 1 on timeout, 2 on bad usage.
set -euo pipefail

expected="${1:-}"
if [ -z "$expected" ]; then
  echo "usage: $0 <release tag>" >&2
  exit 2
fi
url="${READY_URL:-https://datxevui.com/ready}"
timeout="${VERIFY_TIMEOUT:-900}"
interval="${VERIFY_INTERVAL:-20}"

echo "waiting up to ${timeout}s for $url to report $expected"
start=$SECONDS
last=""
while :; do
  # --fail-with-body: a 5xx (the site restarting, or rolled back) keeps its
  # body for the log and the loop simply tries again.
  if body=$(curl -sS --fail-with-body --max-time 10 -H 'Cache-Control: no-cache' "$url" 2>&1); then
    version=$(printf '%s' "$body" | jq -r '.version // empty' 2>/dev/null || true)
    if [ "$version" = "$expected" ]; then
      commit=$(printf '%s' "$body" | jq -r '.commit // empty')
      echo "[$((SECONDS - start))s] $url reports $version${commit:+ (commit $commit)}: the release is live"
      exit 0
    fi
    last="runs ${version:-an unknown version}"
  else
    last="unreachable or unhealthy: $(printf '%s' "$body" | head -c 200 | tr '\n' ' ')"
  fi
  echo "[$((SECONDS - start))s] $last, not $expected yet"
  if [ $((SECONDS - start + interval)) -gt "$timeout" ]; then
    echo "::error::$url did not report $expected within ${timeout}s (last seen: $last). The release is published; the VPS did not install it, or rolled it back. On the VPS: journalctl -u datxevui-update -n 100 --no-pager, and systemctl status datxevui-update.timer."
    exit 1
  fi
  sleep "$interval"
done
