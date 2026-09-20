#!/usr/bin/env bash
# Host-level capacity tuning for the WebRTC call stack — idempotent,
# safe to re-run on every deploy.
#
# Targets (measured 2026-09-20, see worklog):
#   * 50-60 concurrent fully-relayed calls through coturn
#   * 100+ concurrent site users (chat WS + TURN-over-TLS on 443)
#
# What it tunes:
#   1. UFW: widen the TURN relay range to 49160-49760/udp (matches
#      turn.sh --min-port/--max-port). coturn only binds a relay port
#      per allocation — no listeners exist on unused ports, so the wider
#      rule adds no attack surface beyond what TURN already exposes.
#   2. sysctl (WebRTC recommendations): UDP socket buffers. Defaults
#      (208 KiB) drop bursts on relays carrying many calls; 16 MiB max
#      + 256 KiB default is the standard coturn/Jitsi production sizing.
#   3. nginx stream SNI router: worker_connections 768 → 4096. ALL
#      public HTTPS (websites + WebSockets) AND TURN-over-TLS 443 pass
#      through the stream block — 100 users × (page + WS + TURN TLS)
#      exceeded the 768/worker default well before the backend itself
#      would feel any pressure.
#
# What it does NOT touch: conntrack (262144 — ample), somaxconn (4096),
# coturn's fd limit (524288), the 4 GiB swap. All verified sized OK.
set -euo pipefail

changed=0

# ── 1. UFW relay range ────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -qE '^49160:49760/udp\s+ALLOW'; then
    echo "ufw: relay range 49160:49760/udp already allowed"
  else
    # Replace the old narrow rule (49160:49200/udp) if present.
    ufw delete allow 49160:49200/udp >/dev/null 2>&1 || true
    ufw allow 49160:49760/udp comment 'TURN relay range' >/dev/null
    changed=1
    echo "ufw: TURN relay range widened to 49160:49760/udp"
  fi
else
  echo "WARN: ufw not found — ensure 49160-49760/udp is reachable"
fi

# ── 2. sysctl: UDP buffers for WebRTC relay throughput ────────────────
SYSCTL_FILE=/etc/sysctl.d/99-webrtc-call-capacity.conf
if [ -f "$SYSCTL_FILE" ] && sysctl -n net.core.rmem_max 2>/dev/null | grep -q '^16777216$'; then
  echo "sysctl: UDP buffer tuning already applied"
else
  cat > "$SYSCTL_FILE" <<'EOF'
# WebRTC call capacity (deploy/tune-call-capacity.sh — 2026-09-20).
# coturn relay + many concurrent calls need bigger UDP socket buffers
# than the 208 KiB distro default; sizing follows coturn/Jitsi guidance.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
EOF
  sysctl --system >/dev/null 2>&1 || sysctl -p "$SYSCTL_FILE" >/dev/null
  changed=1
  echo "sysctl: UDP buffers tuned (16 MiB max / 256 KiB default)"
fi

# ── 3. nginx stream worker_connections ────────────────────────────────
NGINX_CONF=/etc/nginx/nginx.conf
if grep -q 'worker_connections' "$NGINX_CONF" 2>/dev/null; then
  current=$(grep -oP 'worker_connections\s+\K[0-9]+' "$NGINX_CONF" | head -n1)
  if [ "${current:-0}" -lt 4096 ]; then
    sed -i "s/worker_connections\s\+[0-9]\+;/worker_connections 4096;/" "$NGINX_CONF"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    changed=1
    echo "nginx: worker_connections ${current:-?} → 4096 (reloaded)"
  else
    echo "nginx: worker_connections already >= 4096"
  fi
else
  echo "WARN: nginx.conf has no worker_connections directive — check manually"
fi

[ "$changed" -eq 0 ] && echo "call-capacity tuning: nothing to do (already applied)"
exit 0
