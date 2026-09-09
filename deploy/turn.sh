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
#  1. ensure TURN_USERNAME/TURN_SECRET/PUBLIC_IP exist in .env
#     (secret generated on the server, never committed);
#  2. ensure AUDIO_CALL_ICE_SERVERS in .env points at this TURN server
#     (the backend pushes it to every WebRTC peer in `registered`);
#  3. (re)create the coturn container with the current credentials;
#  4. liveness probe: TCP 3478 answers;
#  5. if .env changed AND the backend is already running, re-deploy the
#     stack with the current image so the backend picks up the new env
#     (docker service update --force does NOT re-interpolate env).
#
# Ports used (host networking): 3478/tcp + 3478/udp (STUN + TURN) and
# 49160-49200/udp (relay allocations). All must be open in any edge
# firewall — SoftLayer bare metal has them open by default.
#
# Wire protocol note: we run plain TURN over 3478 (udp + tcp) WITHOUT
# TLS. DTLS/TLS on 5349 needs certificates; for an audio-call relay
# between two authed app users this is acceptable (SRTP encrypts the
# media end-to-end regardless of the relay transport).
set -euo pipefail

cd "$(cd "$(dirname "$0")" && pwd)"

STACK=datxevui
CONTAINER=coturn-vexevn
IMAGE=coturn/coturn:4.6-alpine

# ── 1. Ensure TURN secrets exist in .env ─────────────────────────────
changed=0
ensure_env() {
  # ensure_env KEY VALUE — set (or replace) KEY=VALUE in .env, WITHOUT
  # sed (the ICE JSON contains backslashes + quotes that sed would
  # mangle): delete the line, re-append, rewrite the file in place.
  local key="$1" value="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    local current
    current=$(grep "^${key}=" .env | head -n1 | cut -d= -f2-)
    if [ "$current" != "$value" ]; then
      local tmp
      tmp=$(mktemp)
      grep -v "^${key}=" .env > "$tmp"
      cat "$tmp" > .env   # in-place rewrite — same inode
      rm -f "$tmp"
      printf '%s=%s\n' "$key" "$value" >> .env
      changed=1
      echo ".env: ${key} updated"
    fi
  else
    printf '%s=%s\n' "$key" "$value" >> .env
    changed=1
    echo ".env: ${key} added"
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

ensure_env TURN_USERNAME "$TURN_USERNAME"
ensure_env TURN_SECRET "$TURN_SECRET"
ensure_env PUBLIC_IP "$PUBLIC_IP"

# ── 2. AUDIO_CALL_ICE_SERVERS → this TURN server ─────────────────────
# The backend reads this env at boot and pushes it to every WebRTC peer
# inside the `registered` frame over the authed WS (never HTTP).
ICE="[{\"urls\":[\"stun:${PUBLIC_IP}:3478\",\"turn:${PUBLIC_IP}:3478?transport=udp\",\"turn:${PUBLIC_IP}:3478?transport=tcp\"],\"username\":\"${TURN_USERNAME}\",\"credential\":\"${TURN_SECRET}\"}]"
ensure_env AUDIO_CALL_ICE_SERVERS "$ICE"

# ── 3. (Re)create the coturn container ───────────────────────────────
# The coturn image's ENTRYPOINT is `turnserver`, so Cmd = flags only.
# NOTE: no --no-loopback-peers/--no-multicast-peers — coturn 4.6 denies
# loopback + multicast peers by DEFAULT (the allow-* flags opt in).
# --Verbose: log TURN allocations / permissions / session events — the
# only way to answer "did the phone ever allocate a relay?" from the logs.
desired_cmd="-n --Verbose --listening-port=3478 --min-port=49160 --max-port=49200 --listening-ip=0.0.0.0 --external-ip=${PUBLIC_IP} --lt-cred-mech --user=${TURN_USERNAME}:${TURN_SECRET} --no-tls --no-dtls"

running_cmd=$(docker inspect --format '{{join .Config.Cmd " "}}' "$CONTAINER" 2>/dev/null || true)
running_state=$(docker inspect --format '{{.State.Status}}' "$CONTAINER" 2>/dev/null || true)
if [ -z "$running_cmd" ] || [ "$running_cmd" != "$desired_cmd" ] || [ "$running_state" != "running" ]; then
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  # shellcheck disable=SC2086
  docker run -d \
    --name "$CONTAINER" \
    --network host \
    --restart unless-stopped \
    $IMAGE $desired_cmd
  echo "coturn: container (re)created (host network, 3478 tcp/udp + 49160-49200/udp)"
else
  echo "coturn: container already correct (running)"
fi

# ── 4. Liveness probe: TURN answers on 3478 ──────────────────────────
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

# ── 5. Backend re-deploy when .env changed ───────────────────────────
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

echo "TURN server ready: ${PUBLIC_IP}:3478 (user: ${TURN_USERNAME})"
