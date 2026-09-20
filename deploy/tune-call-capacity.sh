#!/usr/bin/env bash
# Host-level capacity tuning for the WebRTC call stack — idempotent,
# safe to re-run on every deploy.
#
# Targets (measured 2026-09-20, see worklog + REALTIME_SCALING.md):
#   * "Unlimited-style" concurrent calls: bounded by the MACHINE (NIC
#     bandwidth / pps), not by configured numbers — coturn relay range
#     widened to 49160-65500/udp (16341 ports ≈ 2000 fully-relayed calls
#     by ports; ~600-800 by 1 Gbps bandwidth).
#   * 100+ concurrent site users per node today, ~150K WS sockets
#     before the backend's RAM/fd watermarks fire (WS_MIN_FREE_MEM_MB /
#     WS_FD_HIGH_WATERMARK_PCT — see middleware/resource_guard.rs).
#
# What it tunes:
#   1. UFW: widen the TURN relay range to 49160-65500/udp (matches
#      turn.sh --min-port/--max-port). coturn only binds a relay port
#      per allocation — no listeners exist on unused ports, so the wider
#      rule adds no attack surface beyond what TURN already exposes.
#   2. sysctl: net.ipv4.ip_local_port_range narrowed to 32768-49159 —
#      CRITICAL companion of the wide relay range: the kernel picks
#      OUTBOUND (ephemeral) ports from this range, and the distro default
#      32768-60999 OVERLAPS 49160-60999, so an outbound connection (DB
#      dial, apt, image pull) could steal a port coturn is about to bind
#      as a relay. 16352 ephemeral ports for outbound traffic is plenty.
#   3. sysctl (WebRTC recommendations): UDP socket buffers. Defaults
#      (208 KiB) drop bursts on relays carrying many calls; 16 MiB max
#      + 256 KiB default is the standard coturn/Jitsi production sizing.
#   4. nginx stream SNI router: worker_connections 4096 → 16384. ALL
#      public TLS (websites + WebSockets) AND TURN-over-TLS 443 pass
#      through the stream block — with relayed calls in the hundreds,
#      4096/worker is the next artificial ceiling to remove.
#   5. conntrack: 524288 entries + sized hash buckets. Every relay
#      allocation keeps 2 UDP flows tracked (client→relay, relay→peer);
#      16341 ports ≈ 32K+ flows plus the site's TCP — the 262144 default
#      is inside one bad evening of load testing.
set -euo pipefail

changed=0

# ── 1. UFW relay range ────────────────────────────────────────────────
if command -v ufw >/dev/null 2>&1; then
  if ufw status | grep -qE '^49160:65500/udp\s+ALLOW'; then
    echo "ufw: relay range 49160:65500/udp already allowed"
  else
    # Replace the older narrow rules (49160:49200, 49160:49760) if present.
    ufw delete allow 49160:49200/udp >/dev/null 2>&1 || true
    ufw delete allow 49160:49760/udp >/dev/null 2>&1 || true
    ufw allow 49160:65500/udp comment 'TURN relay range' >/dev/null
    changed=1
    echo "ufw: TURN relay range widened to 49160:65500/udp"
  fi
else
  echo "WARN: ufw not found — ensure 49160-65500/udp is reachable"
fi

# ── 2+3. sysctl: ephemeral/relay port split + UDP buffers ─────────────
SYSCTL_FILE=/etc/sysctl.d/99-webrtc-call-capacity.conf
sysctl_applied() {
  sysctl -n net.ipv4.ip_local_port_range 2>/dev/null | grep -q '^32768\s*49159$' &&
    sysctl -n net.core.rmem_max 2>/dev/null | grep -q '^16777216$'
}
if [ -f "$SYSCTL_FILE" ] && sysctl_applied; then
  echo "sysctl: port-range + UDP buffer tuning already applied"
else
  cat > "$SYSCTL_FILE" <<'EOF'
# WebRTC call capacity (deploy/tune-call-capacity.sh — 2026-09-20).
# coturn relay + many concurrent calls need bigger UDP socket buffers
# than the 208 KiB distro default; sizing follows coturn/Jitsi guidance.
net.core.rmem_max = 16777216
net.core.wmem_max = 16777216
net.core.rmem_default = 262144
net.core.wmem_default = 262144
# Keep kernel EPHEMERAL (outbound) ports strictly BELOW coturn's relay
# range 49160-65500 — the distro default 32768-60999 overlaps it, and an
# outbound dial stealing a relay port breaks TURN allocations randomly.
net.ipv4.ip_local_port_range = 32768 49159
EOF
  sysctl --system >/dev/null 2>&1 || sysctl -p "$SYSCTL_FILE" >/dev/null
  changed=1
  echo "sysctl: UDP buffers tuned (16 MiB max / 256 KiB default) + ephemeral range 32768-49159"
fi

# ── 4. nginx stream worker_connections ────────────────────────────────
NGINX_CONF=/etc/nginx/nginx.conf
if grep -q 'worker_connections' "$NGINX_CONF" 2>/dev/null; then
  current=$(grep -oP 'worker_connections\s+\K[0-9]+' "$NGINX_CONF" | head -n1)
  if [ "${current:-0}" -lt 16384 ]; then
    sed -i "s/worker_connections\s\+[0-9]\+;/worker_connections 16384;/" "$NGINX_CONF"
    nginx -t >/dev/null 2>&1 && systemctl reload nginx
    changed=1
    echo "nginx: worker_connections ${current:-?} → 16384 (reloaded)"
  else
    echo "nginx: worker_connections already >= 16384"
  fi
else
  echo "WARN: nginx.conf has no worker_connections directive — check manually"
fi

# ── 5. conntrack headroom for UDP relay flows ─────────────────────────
CT_MAX=$(sysctl -n net.netfilter.nf_conntrack_max 2>/dev/null || echo 0)
if [ "${CT_MAX:-0}" -lt 524288 ] 2>/dev/null; then
  cat > /etc/sysctl.d/99-webrtc-conntrack.conf <<'EOF'
# UDP relay flows: every TURN allocation keeps ~2 tracked flows; the
# 16341-port relay range plus site TCP needs headroom above the 262144
# default (entries ~320 B each — 512K entries ≈ 160 MiB worst case).
net.netfilter.nf_conntrack_max = 524288
net.netfilter.nf_conntrack_buckets = 131072
EOF
  sysctl --system >/dev/null 2>&1 || sysctl -p /etc/sysctl.d/99-webrtc-conntrack.conf >/dev/null
  changed=1
  echo "sysctl: conntrack max 524288 (buckets 131072)"
else
  echo "sysctl: conntrack already >= 524288"
fi

[ "$changed" -eq 0 ] && echo "call-capacity tuning: nothing to do (already applied)"
exit 0
