#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────
# diagnose-restarts.sh — pinpoint WHY the datxevui backend "reboots"
# periodically. READ-ONLY: no container is stopped, recreated or
# re-deployed; safe to run any time, even mid-call.
#
# Usage (on the VPS, as root or a docker-group user):
#   bash deploy/diagnose-restarts.sh            # full report
#   bash deploy/diagnose-restarts.sh 2>&1 | tee restart-report.txt
#
# What it answers (the three ways a Swarm task "reboots"):
#   1. CGROUP OOM  — the task hit its stack.yml memory limit
#                    (default 2g). Signature: task exit code 137,
#                    `State.OOMKilled: true`, NO kernel oom-killer line.
#   2. HOST OOM    — the node (shared with pdf-tts + coturn + Caddy)
#                    ran out of RAM and the kernel killed a process.
#                    Signature: dmesg "Out of memory: Killed process".
#   3. HEALTHCHECK — the task stopped answering /health; Swarm replaced
#                    it (drops every live WS/call). Signature: docker
#                    events health_status: unhealthy, exit code 0/143,
#                    RSS flat in the 60s "ws hub metrics" log lines.
# Plus the silent killers: unbounded coturn logs filling the disk, and
# a disk-full condition breaking the DB engine.
# ──────────────────────────────────────────────────────────────────────
set -uo pipefail

STACK=datxevui
SVC="${STACK}_backend"
HOURS="${1:-48}"

hr() { printf '\n\033[1;34m══ %s ══\033[0m\n' "$*"; }
note() { printf '\033[0;36m› %s\033[0m\n' "$*"; }

hr "1. Task restart history (${SVC}) — timestamps, exit codes"
note "exit 137 = OOM-killed (cgroup limit); 'task: non-zero exit' with 0 = health replacement"
docker service ps "$SVC" --no-trunc 2>/dev/null | head -25 \
  || echo "(service not found — check STACK name: docker stack ls)"

hr "2. Current task: OOMKilled flag + exit code + restart count"
CID=$(docker ps -q --filter "name=${SVC}" | head -n1)
if [ -n "${CID:-}" ]; then
  docker inspect "$CID" --format \
    'OOMKilled: {{.State.OOMKilled}}  ExitCode: {{.State.ExitCode}}  Restarts: {{.RestartCount}}  StartedAt: {{.State.StartedAt}}'
else
  echo "(no running container found for ${SVC})"
fi

hr "3. Kernel OOM-killer history (host level — includes pdf-tts / coturn victims)"
dmesg -T 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -20 \
  || journalctl -k --since "${HOURS}h ago" 2>/dev/null | grep -iE 'out of memory|oom-kill|killed process' | tail -20 \
  || echo "(no dmesg access — run as root)"

hr "4. Host memory + per-container usage right now"
free -h
echo
docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}\t{{.MemPct}}\t{{.CPUPct}}' 2>/dev/null | head -15

hr "5. Health-check events (last ${HOURS}h) — the 'unhealthy → replaced' signature"
docker events --since "${HOURS}h" --until "$(date +%s)" \
  --filter "type=container" --filter "name=${SVC}" \
  --format '{{.Time}} {{.Action}}' 2>/dev/null \
  | grep -iE 'health_status|oom|die|kill|restart|start' | tail -40

hr "6. Memory trajectory in the backend's own 60s metrics log"
note "rss_mb climbing toward the 2048 limit = in-process growth; flat = external cause"
docker service logs "$SVC" --since "${HOURS}h" 2>&1 \
  | grep -E 'ws hub metrics' | tail -30

hr "7. Backend log tail around errors (panic / shutdown / db failures)"
docker service logs "$SVC" --since "${HOURS}h" 2>&1 \
  | grep -iE 'panic|fatal|shutting down|out of memory|no space|database is|disk' | tail -30

hr "8. Disk + unbounded container logs (the silent disk-fill)"
df -h / /var 2>/dev/null
echo
note "json-file logs WITHOUT max-size grow forever (coturn-vexevn was created without limits)"
du -sh /var/lib/docker/containers/*/ 2>/dev/null | sort -h | tail -8
echo
note "coturn LogConfig (empty Config = UNBOUNDED):"
docker inspect coturn-vexevn --format '{{json .HostConfig.LogConfig}}' 2>/dev/null || echo "(no coturn container)"

hr "9. Config recap: memory limit + healthcheck Swarm enforces"
docker service inspect "$SVC" --format 'Mem limit: {{.Spec.TaskTemplate.Resources.Limits.MemoryBytes}}  Health: {{json .Spec.TaskTemplate.ContainerSpec.Healthcheck}}' 2>/dev/null

hr "Interpretation cheat-sheet"
cat <<'EOF'
• Section 1/2 exit 137 or OOMKilled:true        → the backend itself outgrew the 2 GB task limit.
  → check Section 6: rss_mb slope. Rising slope = leak or undersized limit
    (bump APP_MEM_LIMIT in .env, or find the leak). Flat = spike (osm.import?).
• Section 3 has 'Killed process' lines           → HOST-level OOM. The kernel chose the fattest
  victim (often this backend, sometimes pdf-tts — both stacks restart).
  → check Section 4: which co-tenant eats the RAM; add limits on both stacks.
• Section 5 health_status: unhealthy + restart   → the task hung or was CPU-starved >4 min.
  → check Section 9 healthcheck + Section 4 CPU%; verify the deployed image has
    the hardened healthcheck (timeout 10s, retries 8).
• Section 8 usage near 100% or huge json logs    → disk-fill side effects. Re-run
    bash deploy/turn.sh   (recreates coturn with capped logs) and prune old logs.
EOF
echo
echo "Done. Paste the whole output back for analysis."
