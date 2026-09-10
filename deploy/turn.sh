#!/usr/bin/env bash
# coturn (TURN/STUN relay) — idempotent deployment for WebRTC calls.
#
# WHY a standalone container and NOT a swarm service: TURN needs
#  - real client source IPs (swarm's routing mesh SNATs ingress traffic),
#  - direct UDP relay ports (49160-49200) with no mesh indirection.
# `--network host` on a plain `docker run` gives both; swarm stack
# files cannot. The container is single-purpose and stateless, so
# swarm scheduling adds nothing here — `--restart unless-stopped`
# is the availability story.
#
# What this script does (safe to re-run, part of every deploy):
#  1. ensure TURN_USERNAME/TURN_SECRET/PUBLIC_IP/TURN_DOMAIN exist in .env
#     (secret generated on the server, never committed);
#  2. ensure AUDIO_CALL_ICE_SERVERS in .env points at this TURN server
#     (the backend pushes it to every WebRTC peer in `registered`);
#  3. sync the Let's Encrypt certificate for TURN_DOMAIN (issued+renewed
#     by the shared Caddy) into /opt/vexevn/turn-certs/; if none exists
#     yet (DNS not pointed at this host, cert not issued), keep/issue a
#     self-signed PLACEHOLDER so the TLS listener is always up;
#  4. (re)create the coturn container with the current credentials +
#     TLS listener on 5349 (public TCP 443 is SNI-routed to it by host
#     nginx — see /etc/nginx/conf.stream.d/turn-sni-router.conf);
#  5. liveness probe: TCP 3478 answers;
#  6. if .env changed AND the backend is already running, re-deploy the
#     stack with the current image so the backend picks up the new env
#     (docker service update --force does NOT re-interpolate env).
#
# Ports used (host networking): 3478/tcp + 3478/udp (STUN + TURN),
# 5349/tcp (TURN-over-TLS; reached publicly via nginx SNI routing on
# 443/tcp), 49160-49200/udp (relay allocations). ufw already allows
# 3478, 49160-49200/udp and 443/tcp; 5349 stays loopback-only.
#
# Wire protocol note: 2026-09-10 TLS added for corporate networks.
# Corporate firewalls typically allow only outbound TCP 443 —
# `turns:turn.datxevui.com:443?transport=tcp` gives those phones a
# relay path (looks like ordinary HTTPS to the firewall). Plain TURN
# on 3478 stays for networks without such restrictions. TLS handshake
# needs the cert for turn.datxevui.com: Caddy auto-issues it (site
# block in the shared Caddyfile) and turn-cert-sync.sh (cron, 15 min)
# copies renewed certs here and SIGHUPs coturn.
#
# Wire protocol note (kept from history): SRTP encrypts media
# end-to-end regardless of relay transport, so plain TURN on 3478
# remains acceptable for authed app users.
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"

STACK=datxevui
CONTAINER=coturn-vexevn
IMAGE=coturn/coturn:4.6-alpine

# ── 1. Ensure TURN secrets exist in .env ─────────────────────────────
changed=0
ensure_env() {
  # ensure_env KEY VALUE — set (or replace) KEY='VALUE' in .env, WITHOUT
  # sed (the ICE JSON contains backslashes + quotes that sed would
  # mangle): delete the line, re-append, rewrite the file in place.
  #
  # QUOTING (production bug, 2026-09-09): the value is stored WRAPPED IN
  # SINGLE QUOTES. deploy.sh does `set -a; . ./.env; set +a` before
  # `docker stack deploy` — bash `source` strips double quotes from an
  # UNQUOTED value, so `AUDIO_CALL_ICE_SERVERS=[{"urls":…}]` reached the
  # container as `[{urls:…}]` → serde_json parse failed → backend pushed
  # iceServers:[] → every peer fell back to public STUN → calls behind
  # CGNAT stuck on "connecting" forever. Single quotes survive `source`
  # (bash removes only the outer pair) and docker stack interpolation,
  # keeping the inner double quotes intact. The comparison below strips
  # the wrapper so a re-run doesn't rewrite a correct line.
  local key="$1" value="$2"
  local raw=""
  if grep -q "^${key}=" .env 2>/dev/null; then
    raw=$(grep "^${key}=" .env | head -n1 | cut -d= -f2-)
  fi
  # strip one pair of surrounding single (or double) quotes for compare
  local current="$raw"
  current="${current#\'}"; current="${current%\'}"
  current="${current#\"}"; current="${current%\"}"
  # Rewrite when the VALUE differs OR when the stored form is not
  # single-quoted (a bare JSON value is exactly the foot-gun: it sits
  # valid in the file but gets its inner double quotes stripped by
  # `source`, arriving in the container mangled).
  if [ "$current" != "$value" ] || [ "${raw:0:1}" != "'" ]; then
    local tmp
    tmp=$(mktemp)
    grep -v "^${key}=" .env > "$tmp"
    cat "$tmp" > .env   # in-place rewrite — same inode
    rm -f "$tmp"
    printf "%s='%s'\n" "$key" "$value" >> .env
    changed=1
    echo ".env: ${key} updated (single-quoted)"
  fi
}

[ -f .env ] || { echo "FATAL: .env missing (run deploy.sh first)"; exit 1; }
set -a; . ./.env; set +a

: "${TURN_USERNAME:=vexevn}"
if [ -z "${TURN_SECRET:-}" ]; then
  TURN_SECRET=$(openssl rand -hex 16)
fi
# Public IP: explicit env > the address the node actually egresses with.
if [ -z "${PUBLIC_IP:-}" ]; then
  PUBLIC_IP=$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)
fi
[ -n "$PUBLIC_IP" ] || { echo "FATAL: could not detect PUBLIC_IP (set it in .env)"; exit 1; }
# TURN domain: the TLS hostname phones use for turns: (SNI-routed by nginx).
: "${TURN_DOMAIN:=turn.datxevui.com}"

ensure_env TURN_USERNAME "$TURN_USERNAME"
ensure_env TURN_SECRET "$TURN_SECRET"
ensure_env PUBLIC_IP "$PUBLIC_IP"
ensure_env TURN_DOMAIN "$TURN_DOMAIN"

# ── 2. AUDIO_CALL_ICE_SERVERS → this TURN server ─────────────────────
# The backend reads this env at boot and pushes it to every WebRTC peer
# inside the `registered` frame over the authed WS (never HTTP).
# 2026-09-10: turns:443 FIRST — corporate networks usually allow only
# outbound TCP 443; hostname + raw-IP entries are BOTH listed so peers
# work even when the phone's resolver is blocked/hijacked.
ICE="[{\"urls\":[\"turns:${TURN_DOMAIN}:443?transport=tcp\",\"turn:${TURN_DOMAIN}:3478?transport=tcp\",\"turn:${TURN_DOMAIN}:3478?transport=udp\",\"stun:${TURN_DOMAIN}:3478\",\"turn:${PUBLIC_IP}:3478?transport=tcp\",\"turn:${PUBLIC_IP}:3478?transport=udp\",\"stun:${PUBLIC_IP}:3478\"],\"username\":\"${TURN_USERNAME}\",\"credential\":\"${TURN_SECRET}\"}]"
ensure_env AUDIO_CALL_ICE_SERVERS "$ICE"

# ensure_env may have just rewritten .env (quoting fix). Re-source so
# the stack deploy below interpolates the CLEAN values — the shell
# still holds whatever the PRE-fix .env exported at the top of this
# script (the original bug: mangled there, mangled in the container).
if [ "$changed" -eq 1 ]; then
  set -a; . ./.env; set +a
fi

# ── 3. Certificate sync: Caddy-issued LE cert → turn-certs/ ─────────
CERT_DIR=./turn-certs
CADDY_CERT_ROOT=/var/lib/docker/volumes/pdf-tts_caddy_data/_data/caddy/certificates
mkdir -p "$CERT_DIR"
# 755 (NOT 700): the coturn image runs as nobody:nogroup and must be
# able to traverse the directory to read the certs (0644 files).
chmod 755 "$CERT_DIR"

# Look for the LE cert Caddy issued for TURN_DOMAIN under ANY issuer dir.
le_crt=""
for f in "$CADDY_CERT_ROOT"/*/"$TURN_DOMAIN"/"$TURN_DOMAIN".crt; do
  [ -f "$f" ] && le_crt="$f" && break
done
le_key=""
if [ -n "$le_crt" ]; then
  le_key="${le_crt%.crt}.key"
  [ -f "$le_key" ] || le_crt=""
fi

# valid pair + expiry in the future → usable LE cert
le_usable=0
if [ -n "$le_crt" ] && openssl x509 -in "$le_crt" -noout -checkend 86400 >/dev/null 2>&1; then
  le_usable=1
fi

if [ "$le_usable" -eq 1 ]; then
  if ! cmp -s "$le_crt" "$CERT_DIR/fullchain.pem" 2>/dev/null; then
    install -m 0644 "$le_crt" "$CERT_DIR/fullchain.pem.new"
    install -m 0644 "$le_key" "$CERT_DIR/privkey.pem.new"
    mv -f "$CERT_DIR/fullchain.pem.new" "$CERT_DIR/fullchain.pem"
    mv -f "$CERT_DIR/privkey.pem.new" "$CERT_DIR/privkey.pem"
    echo "certs: installed LE cert for $TURN_DOMAIN (expiry: $(openssl x509 -in "$CERT_DIR/fullchain.pem" -noout -enddate | cut -d= -f2))"
  fi
fi

# Placeholder: keep the TLS listener up before the LE cert exists.
if [ ! -s "$CERT_DIR/fullchain.pem" ] || [ ! -s "$CERT_DIR/privkey.pem" ]; then
  echo "certs: no LE cert yet (DNS for $TURN_DOMAIN not pointing here / not issued) — self-signed placeholder"
  openssl req -x509 -newkey rsa:2048 -nodes -days 825 \
    -keyout "$CERT_DIR/privkey.pem" -out "$CERT_DIR/fullchain.pem" \
    -subj "/CN=$TURN_DOMAIN" -addext "subjectAltName=DNS:$TURN_DOMAIN" \
    >/dev/null 2>&1
  chmod 0644 "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem"
fi

# ── 4. (Re)create the coturn container ───────────────────────────────
# The coturn image's ENTRYPOINT is `turnserver`, so Cmd = flags only.
# NOTE: no --no-loopback-peers/--no-multicast-peers — coturn 4.6 denies
# loopback + multicast peers by DEFAULT (the allow-* flags opt in).
# --Verbose: log TURN allocations / permissions / session events — the
# only way to answer "did the phone ever allocate a relay?" from the logs.
# --realm: MUST be non-empty. With lt-cred-mech but no -r, coturn
# challenges 401 with realm="" — libwebrtc (Chrome + flutter_webrtc)
# REJECTS an empty realm ("Setting realm to the empty string, this is
# not supported") and aborts every TURN allocation → no relay
# candidates → calls behind CGNAT stuck on "connecting" (production
# incident 2026-09-09: server-side TURN tests passed because a
# hand-rolled client tolerates the empty realm; the phone did not).
# TLS: --tls-listening-port=5349 (public 443 is SNI-routed here by
# nginx). --no-dtls stays: no DTLS/UDP listener is needed (3478/udp
# covers plain UDP TURN; TLS-TCP 443 covers corporate networks).
base_cmd="-n --Verbose --realm=datxevui.com --listening-port=3478 --min-port=49160 --max-port=49200 --listening-ip=0.0.0.0 --external-ip=${PUBLIC_IP} --lt-cred-mech --user=${TURN_USERNAME}:${TURN_SECRET} --no-dtls"
tls_args="--tls-listening-port=5349 --cert=/etc/cert/fullchain.pem --pkey=/etc/cert/privkey.pem"
desired_cmd="$base_cmd $tls_args"

running_cmd=$(docker inspect --format '{{join .Config.Cmd " "}}' "$CONTAINER" 2>/dev/null || true)
running_state=$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)
# Log limits: the first coturn container was started WITHOUT --log-opt,
# so with --Verbose its json-file log grows UNBOUNDED — every TURN
# allocation/permission event plus the constant internet scanner noise
# on public 3478 lands in /var/lib/docker/containers/<id>-json.log and
# slowly fills the disk. A missing max-size therefore counts as
# "container wrong" and triggers a re-create (the Cmd comparison alone
# would leave the unbounded-log container running forever).
log_max_size=$(docker inspect --format '{{index .HostConfig.LogConfig.Config "max-size"}}' "$CONTAINER" 2>/dev/null || true)

# Cert fingerprint stamp: renewed cert (same flags, changed files) → SIGHUP.
cert_stamp="$CERT_DIR/.cert.sha256"
sha_head() { sha256sum "$CERT_DIR/fullchain.pem" "$CERT_DIR/privkey.pem" 2>/dev/null | awk '{print $1}' | sha256sum | awk '{print $1}'; }
cert_now=$(sha_head)
cert_prev=""
[ -f "$cert_stamp" ] && cert_prev=$(cat "$cert_stamp")

if [ -z "$running_cmd" ] || [ "$running_cmd" != "$desired_cmd" ] || [ "$running_state" != "running" ] || [ -z "$log_max_size" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker run -d \
    --name "$CONTAINER" \
    --network host \
    --restart unless-stopped \
    --log-driver json-file --log-opt max-size=20m --log-opt max-file=3 \
    --memory 512m --memory-swap 512m \
    -v "$(cd "$CERT_DIR" && pwd)":/etc/cert:ro \
    $IMAGE $desired_cmd
  echo "$cert_now" > "$cert_stamp"
  echo "coturn: container (re)created (host network, 3478 tcp/udp + 49160-49200/udp + TLS 5349→443, logs capped 3x20m, mem 512m)"
elif [ "$cert_now" != "$cert_prev" ]; then
  # Same flags, new cert bytes → restart the container to load them.
  # NOT SIGHUP: coturn 4.6-alpine SEGFAULTS on SIGHUP with TLS listeners
  # loaded (observed in production 2026-09-10 10:00 CEST: the reload path
  # faulted at cert-swap time and TURN stayed down until the container was
  # recreated ~15 min later). A restart is a 1-2s TURN blip once per
  # ~60-day renewal — callers retry through ICE candidates; live calls on
  # an established relay allocation are not affected by the listener
  # restart (the kernel keeps the 5-tuple, coturn re-reads state from the
  # kernel socket).
  docker restart -t 10 "$CONTAINER" >/dev/null 2>&1 || \
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  echo "$cert_now" > "$cert_stamp"
  echo "coturn: certificate renewed → container restarted (SIGHUP segfaults coturn 4.6)"
else
  echo "coturn: container already correct (running, cert current)"
fi

# ── 5. Liveness probe: TURN answers on 3478 ──────────────────────────
sleep 1
if docker logs --tail 5 "$CONTAINER" 2>&1 | grep -qi "error\|cannot\|invalid"; then
  echo "WARN: coturn log shows problems:"
  docker logs --tail 20 "$CONTAINER" || true
fi
if timeout 5 bash -c "</dev/tcp/${PUBLIC_IP}/3478" 2>/dev/null; then
  echo "coturn: TCP 3478 reachable"
else
  echo "WARN: TCP ${PUBLIC_IP}:3478 not reachable yet (check: docker logs $CONTAINER)"
fi

# ── 6. Backend re-deploy when .env changed ───────────────────────────
# Skipped when invoked from deploy.sh (TURN_FROM_DEPLOY=1) — the caller
# deploys the stack right after with the new env anyway.
if [ "$changed" -eq 1 ] && [ "${TURN_FROM_DEPLOY:-0}" != "1" ]; then
  CUR_IMAGE=$(docker service inspect --format \
    '{{.Spec.TaskTemplate.ContainerSpec.Image}}' "${STACK}_backend" 2>/dev/null || true)
  if [ -n "$CUR_IMAGE" ] && [ -f stack.yml ]; then
    echo "backend env changed — redeploying the stack with image $CUR_IMAGE"
    IMAGE="$CUR_IMAGE" docker stack deploy --with-registry-auth -c stack.yml "$STACK"
  else
    echo "NOTE: backend not deployed yet — the next deploy.sh run picks up the new env"
  fi
fi

# ── 7. Verify the backend actually RECEIVED parseable ICE JSON ───────
# The value passes bash `source` + docker stack interpolation — both are
# quoting minefields. If the container env lost its double quotes the
# backend silently pushes iceServers:[] and every call across NAT fails.
# Standalone runs only (TURN_FROM_DEPLOY=1 runs BEFORE the caller's
# stack deploy — deploy.sh owns the post-deploy probe in that flow).
if [ "${TURN_FROM_DEPLOY:-0}" != "1" ]; then
  for _ in $(seq 1 12); do
    CID=$(docker ps -q --filter "name=${STACK}_backend" | head -n1)
    [ -n "$CID" ] || { sleep 5; continue; }
    ENVVAL=$(docker exec "$CID" env 2>/dev/null | grep '^AUDIO_CALL_ICE_SERVERS=' | cut -d= -f2-)
    if echo "$ENVVAL" | grep -q '"urls"'; then
      echo "backend env OK — ICE JSON reached the container quoted:"
      echo "  ${ENVVAL:0:120}…"
      break
    fi
    # Only fail loudly once the rollout has settled (last attempt).
    if [ "$_" = 12 ]; then
      echo "WARN: backend container env does NOT contain quoted ICE JSON:"
      echo "  got: ${ENVVAL:-<unset>}"
      echo "  Fix .env quoting (single-quote the value) and re-run turn.sh"
    fi
    sleep 5
  done
fi

# ── 8. Install the cert-sync cron (self-contained, idempotent) ─────
# turn-cert-sync.sh is EMBEDDED here: turn.sh is the only file the CD
# pipeline must ship for the whole TURN-TLS lifecycle. The cron job
# re-runs this script every 15 min — a silent no-op unless Caddy
# issued/renewed the cert for TURN_DOMAIN, in which case coturn gets
# the new bytes via SIGHUP (or a recreate if the TLS listener was
# never up). Skipped on non-root (cron install needs root).
DIR=$(pwd)   # turn.sh cd'd to its own directory at the top
SYNC_SCRIPT="$DIR/turn-cert-sync.sh"
cat > "${SYNC_SCRIPT}.new" <<'SYNC_EOF'
#!/usr/bin/env bash
# /opt/vexevn/turn-cert-sync.sh — keep coturn's TLS cert fresh (cron: 15 min).
# Generated by turn.sh — do not edit by hand.
set -uo pipefail
DIR=$(cd "$(dirname "$0")" && pwd)
exec 9>/var/lock/turn-cert-sync.lock
flock -n 9 || exit 0
bash "$DIR/turn.sh" >/dev/null 2>&1 || {
  echo "[turn-cert-sync $(date -u +%FT%TZ)] turn.sh failed — run: bash $DIR/turn.sh"
  exit 1
}
NEW_STAMP=$(sha256sum "$DIR/turn-certs/fullchain.pem" "$DIR/turn-certs/privkey.pem" 2>/dev/null | awk '{print $1}' | sha256sum | awk '{print $1}')
LAST_RUN_FILE=/var/run/turn-cert-sync.stamp
[ -f "$LAST_RUN_FILE" ] && [ "$(cat "$LAST_RUN_FILE")" = "$NEW_STAMP" ] && exit 0
echo "$NEW_STAMP" > "$LAST_RUN_FILE"
echo "[turn-cert-sync $(date -u +%FT%TZ)] cert now: $(openssl x509 -in "$DIR/turn-certs/fullchain.pem" -noout -subject 2>/dev/null) expires $(openssl x509 -in "$DIR/turn-certs/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)"
SYNC_EOF
if ! cmp -s "${SYNC_SCRIPT}.new" "$SYNC_SCRIPT" 2>/dev/null; then
  mv -f "${SYNC_SCRIPT}.new" "$SYNC_SCRIPT"
  chmod 0755 "$SYNC_SCRIPT"
  echo "turn-cert-sync.sh installed/updated"
else
  rm -f "${SYNC_SCRIPT}.new"
fi
if [ "$(id -u)" = "0" ] && [ ! -f /etc/cron.d/turn-cert-sync ]; then
  cat > /etc/cron.d/turn-cert-sync <<'CRON_EOF'
# Sync the Let's Encrypt cert for turn.datxevui.com (issued/renewed by
# the shared Caddy) into coturn and reload it. Installed by turn.sh.
*/15 * * * * root /opt/vexevn/turn-cert-sync.sh >> /var/log/turn-cert-sync.log 2>&1
CRON_EOF
  chmod 0644 /etc/cron.d/turn-cert-sync
  systemctl restart cron 2>/dev/null || service cron restart 2>/dev/null || true
  echo "cron /etc/cron.d/turn-cert-sync installed (every 15 min)"
fi

echo "TURN server ready: ${PUBLIC_IP}:3478 (plain) + turns:${TURN_DOMAIN}:443 (TLS, user: ${TURN_USERNAME})"
