#!/bin/bash
# freeze-watchdog.sh — capture WHY the datxevui backend runtime freezes.
#
# Background (2026-09-09/10 incidents): after a call hangup / during
# RINGING, the whole tokio runtime froze (60s "ws hub metrics" ticks
# stopped, /health stopped answering); after the missed healthchecks
# Swarm replaced the task (exit 137 "dockerexec: unhealthy container").
# /health is a pure liveness endpoint — for it to fail, ALL tokio
# worker threads must be blocked (or the I/O driver starved because
# every worker is stuck in a SYNCHRONOUS syscall). This watchdog grabs
# evidence the moment /health first fails — BEFORE Swarm kills the
# container.
#
# Output: /root/freeze-dumps/dump-<timestamp>.txt (max 5 per incident).
# Runs as a systemd service (freeze-watchdog.service).
#
# Evidence layers per dump:
#   1. Task history + host state + container health log + log tail.
#   2. Per-thread kernel evidence (comm | state | wchan | syscall |
#      kernel-stack).
#   3. gdb `thread apply all bt` — SYMBOLIZED user-space backtraces for
#      every thread (needs gdb on the host + a backend build with
#      `debug = "line-tables-only"`; see the Cargo.toml release profile).
#      This is the layer that names the exact function + file:line each
#      worker is blocked inside — futex uaddrs alone cannot distinguish
#      an idle tokio Parker from a held parking_lot/DashMap lock.
#
# Reading a dump:
#   * tokio-rt-worker threads in futex(...)        → deadlock (note the
#     uaddr argument — same uaddr on 2+ threads = one contended lock)
#   * tokio-rt-worker in write(...) on fd 1        → stdout pipe full
#     (blocked log write — docker daemon not draining)
#   * tokio-rt-worker state R + high CPU           → busy loop
#   * threads in `running` with no syscall         → userspace spin
#   * futex on sqlx threads                        → pool contention
#   * gdb frames inside rustqlite/rust-sql locks   → engine-level wedge

DUMPS=/root/freeze-dumps
SVC=datxevui_backend
mkdir -p "$DUMPS"

fail_dumps=0

dump_once() {
  local ts file cid tini bpid
  ts=$(date +%Y%m%d-%H%M%S)
  file="$DUMPS/dump-$ts.txt"
  cid=$(docker ps -q --filter "name=$SVC" | head -1)
  {
    echo "════ freeze dump @ $(date -Is) ════"
    echo
    echo "── task history ──"
    docker service ps "$SVC" --no-trunc 2>/dev/null | head -6
    echo
    echo "── host state ──"
    uptime; free -h
    docker stats --no-stream --format 'table {{.Name}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.PIDs}}' 2>/dev/null
    echo
    if [ -n "$cid" ]; then
      echo "── container health log (last 5 results) ──"
      docker inspect "$cid" --format '{{range .State.Health.Log}}{{.ExitCode}} @ {{.End}}: {{.Output}}{{"\n"}}{{end}}' 2>/dev/null | tail -5
      echo
      echo "── backend log tail (30) ──"
      docker logs --tail 30 "$cid" 2>&1
      echo
      tini=$(docker inspect -f '{{.State.Pid}}' "$cid" 2>/dev/null)
      if [ -n "$tini" ] && [ "$tini" != "0" ]; then
        bpid=$(pgrep -P "$tini" 2>/dev/null | head -1)
        if [ -n "$bpid" ]; then
          echo "── backend pid $bpid: per-thread evidence ──"
          echo "(comm | state | wchan | syscall | kernel-stack)"
          for t in /proc/$bpid/task/*; do
            tid=${t##*/}
            name=$(cat "$t/comm" 2>/dev/null)
            state=$(awk '{print $3}' "$t/stat" 2>/dev/null)
            wchan=$(cat "$t/wchan" 2>/dev/null)
            syscall=$(cat "$t/syscall" 2>/dev/null | head -c 120)
            kstack=$(cat "$t/stack" 2>/dev/null | head -3 | tr '\n' ' ')
            echo "tid=$tid [$name] state=$state wchan=$wchan"
            echo "    syscall: $syscall"
            echo "    kstack:  $kstack"
          done
          echo
          echo "── /proc/$bpid/status ──"
          grep -E "Threads|VmRSS|voluntary|nonvoluntary" /proc/$bpid/status 2>/dev/null
          echo
          echo "── cgroup v2 (cpu + memory) ──"
          CG=$(readlink -f /proc/$bpid/cgroup 2>/dev/null)
          cat /sys/fs/cgroup/"$(echo "$CG" | sed 's|.*/docker/||; s|/$||')"/cpu.stat 2>/dev/null || \
            docker exec "$cid" cat /sys/fs/cgroup/cpu.stat 2>/dev/null
          docker exec "$cid" cat /sys/fs/cgroup/memory.current 2>/dev/null \
            && docker exec "$cid" cat /sys/fs/cgroup/memory.events 2>/dev/null

          # ── gdb symbolized backtraces (the decisive layer) ──────────
          # Attaching briefly PTRACE-stops the process — the runtime is
          # already frozen (health failing), so this cannot make things
          # meaningfully worse; Swarm's replacement is minutes away.
          # The binary is docker-cp'd out as a separate symbol file:
          # the container's /app/backend is not openable from the host
          # mount namespace, and the image is built with
          # `debug = "line-tables-only"` exactly for this.
          if command -v gdb >/dev/null 2>&1; then
            SYMS="$DUMPS/backend-symbols"
            IMG=$(docker inspect -f '{{.Image}}' "$cid" 2>/dev/null)
            STAMP="$DUMPS/backend-symbols.image"
            if [ ! -f "$SYMS" ] || [ "$(cat "$STAMP" 2>/dev/null)" != "$IMG" ]; then
              docker cp "$cid:/app/backend" "$SYMS" 2>/dev/null \
                && echo "$IMG" > "$STAMP" \
                || SYMS=""
            fi
            echo
            echo "── gdb: thread apply all bt ──"
            if [ -n "$SYMS" ]; then
              timeout 40 gdb -p "$bpid" "$SYMS" -batch \
                -ex 'set pagination off' \
                -ex 'set print thread-events off' \
                -ex 'thread apply all bt' 2>&1 | head -700
            else
              timeout 40 gdb -p "$bpid" -batch \
                -ex 'set pagination off' \
                -ex 'set print thread-events off' \
                -ex 'thread apply all bt' 2>&1 | head -700
            fi
            echo "── gdb done ──"
          else
            echo "!! gdb not installed — backtraces skipped (apt-get install -y gdb)"
          fi
        else
          echo "!! backend process not found under tini pid $tini"
        fi
      fi
    else
      echo "!! no running container for $SVC (mid-replacement?)"
      docker ps -a --filter "name=$SVC" --format '{{.Names}} {{.Status}}' | head -5
    fi
  } > "$file" 2>&1
  echo "freeze-dump written: $file (incident dump #$((++fail_dumps)))"
}

while true; do
  cid=$(docker ps -q --filter "name=$SVC" | head -1)
  if [ -n "$cid" ]; then
    # Only trust failures past the start period (deploys also look "down").
    started=$(docker inspect -f '{{.State.StartedAt}}' "$cid" 2>/dev/null)
    if [ -n "$started" ]; then
      age=$(( $(date +%s) - $(date -d "$started" +%s) ))
      if [ "$age" -gt 90 ]; then
        if ! docker exec "$cid" curl -sf -m 3 http://localhost:8080/health >/dev/null 2>&1; then
          dump_once
          # Re-dump every 30s while failing (max 5), then back off.
          if [ "$fail_dumps" -ge 5 ]; then
            sleep 120
          else
            sleep 30
          fi
          continue
        else
          # Healthy again — reset the incident counter.
          [ "$fail_dumps" -gt 0 ] && echo "$(date -Is) recovered after $fail_dumps dumps" >> "$DUMPS/incidents.log"
          fail_dumps=0
        fi
      fi
    fi
  fi
  sleep 5
done
