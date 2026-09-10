#!/usr/bin/env bash
# deploy/setup-sni-router.sh — ONE-TIME (idempotent) host setup that lets
# coturn's TURN-over-TLS listener share public TCP 443 with the websites.
#
# Run as root ON THE SERVER (169.58.249.26 / vmi3538824):
#   bash /opt/vexevn/setup-sni-router.sh
# Executed 2026-09-10 on the production node; re-runs are safe.
#
# WHY: corporate firewalls usually allow ONLY outbound TCP 443. The
# `turns:turn.datxevui.com:443` ICE entry (see turn.sh) needs coturn's
# TLS listener reachable on 443 — but the shared Caddy edge owns 443
# for the websites. Solution: Caddy's published TCP port moves
# 443 → 8443 (deploy/swarm/stack.yml in the pdf-tts repo), and host
# nginx takes 443 as an L4 SNI router (stream + ssl_preread):
#
#   SNI turn.datxevui.com  →  127.0.0.1:5349  (coturn TLS listener)
#   anything else          →  127.0.0.1:8443  (Caddy: datxevui.com,
#                         www, media, the pdf-tts site, ACME TLS-ALPN)
#
# TLS is passed through untouched — coturn terminates TURN-TLS itself,
# Caddy terminates TLS for its hostnames. HTTP-01 ACME challenges are
# unaffected (Caddy keeps :80). Caddy keeps 443/udp for HTTP/3.
#
# ORDER MATTERS: Caddy must ALREADY be on 8443 (deploy the pdf-tts
# stack with the 8443 change first); this script waits for :443 to be
# free before starting nginx.
#
# ufw prerequisites (already in place on the prod node):
#   443/tcp ALLOW (websites + turns), 3478 tcp+udp, 49160:49200/udp.
#   5349 and 8443 stay loopback-only — never open them.
set -euo pipefail

if [ "$(id -u)" != "0" ]; then
  echo "FATAL: run as root (needs apt + /etc/nginx writes)" >&2
  exit 1
fi

echo "== 1. wait for :443 to be free (Caddy must have moved to 8443) =="
for i in $(seq 1 30); do
  if ! ss -tln | grep -q ':443 '; then
    echo "port 443 free"
    break
  fi
  [ "$i" = 30 ] && { echo "FATAL: something still listens on 443:"; ss -tlnp | grep ':443 '; exit 1; }
  sleep 2
done

echo "== 2. install nginx + stream module =="
export DEBIAN_FRONTEND=noninteractive
if ! dpkg -s nginx >/dev/null 2>&1; then
  apt-get update -qq
  # service start failure is expected (ports busy) — package still installs
  apt-get install -y nginx libnginx-mod-stream 2>&1 | tail -2 || true
fi
dpkg -s nginx >/dev/null 2>&1 || { echo "FATAL: nginx not installed"; exit 1; }
dpkg -s libnginx-mod-stream >/dev/null 2>&1 || { apt-get install -y libnginx-mod-stream; }

echo "== 3. configure =="
# default site listens :80 which Caddy (docker) owns — remove it
rm -f /etc/nginx/sites-enabled/default

# top-level include for stream configs (once)
touch /etc/nginx/nginx.conf
if ! grep -q 'conf.stream.d' /etc/nginx/nginx.conf; then
  printf '\n# stream (L4) SNI routing configs (2026-09-10 TURN-TLS)\ninclude /etc/nginx/conf.stream.d/*.conf;\n' >> /etc/nginx/nginx.conf
fi
mkdir -p /etc/nginx/conf.stream.d

cat > /etc/nginx/conf.stream.d/turn-sni-router.conf <<'NGINX_EOF'
# /etc/nginx/conf.stream.d/turn-sni-router.conf — TCP 443 SNI router.
#
# WHY: coturn needs TURN-over-TLS ("turns:") reachable on TCP 443 — the
# only outbound port most corporate firewalls allow. The shared Caddy
# (pdf-tts stack) now listens on 8443 (published 8443:443 in the pdf-tts
# stack.yml) and this nginx stream block owns public 443/tcp, routing by
# TLS SNI:
#
#   turn.datxevui.com  ->  127.0.0.1:5349  (coturn TLS listener)
#   everything else    ->  127.0.0.1:8443  (Caddy: datxevui.com, www,
#                                            media, pdf-tts site)
#
# TLS is passed through UNTOUCHED (ssl_preread reads only the
# ClientHello SNI; coturn terminates TLS itself with the LE cert for
# turn.datxevui.com, Caddy terminates TLS for its own hostnames). This
# also keeps Caddy's TLS-ALPN-01 ACME challenges working: they carry
# the website's SNI and land on Caddy. Caddy's HTTP-01 challenges are
# unaffected (nginx does not listen on :80 — Caddy keeps :80).
#
# Caddy's turn.datxevui.com site block exists only so Caddy ISSUES the
# cert (HTTP-01 on :80); turn traffic never reaches it (SNI-routed to
# coturn first). /opt/vexevn/turn-cert-sync.sh (cron) copies the cert
# to coturn.
#
# 443/udp stays bound by Caddy (HTTP/3) — not touched here.
# ufw allows 443/tcp inbound; 5349 and 8443 are loopback-only.

stream {
    log_format sni_router '$remote_addr [$time_local] sni=$ssl_preread_server_name '
                          'upstream=$upstream_addr sent=$bytes_sent rcvd=$bytes_received';
    access_log /var/log/nginx/sni-router.log sni_router;

    map $ssl_preread_server_name $upstream_443 {
        turn.datxevui.com    127.0.0.1:5349;
        default              127.0.0.1:8443;
    }

    server {
        listen 443;
        listen [::]:443;
        ssl_preread on;
        proxy_pass $upstream_443;
        proxy_connect_timeout 5s;
        # TURN sessions are long-lived (calls); don't kill quiet ones.
        proxy_timeout 3600s;
        # TURN media needs low latency — keep buffering off (default).
    }
}
NGINX_EOF

echo "== 4. validate + start =="
nginx -t
systemctl enable nginx >/dev/null 2>&1 || true
systemctl restart nginx
sleep 1
systemctl is-active nginx
ss -tlnp | grep ':443 ' || { echo "FATAL: nginx not listening on 443"; exit 1; }
echo "nginx SNI router is LIVE on 443 (turn.datxevui.com -> 5349, default -> 8443)"
