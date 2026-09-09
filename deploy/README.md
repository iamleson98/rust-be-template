# Deployment — single image + GitHub CI/CD

Production runbook for the single-image stack. **Two supported topologies:**

- **A. Shared Swarm node + Caddy (CURRENT — datxevui.com):** the server
  already runs Docker Swarm with a `pdf-tts` stack and a shared Caddy that
  owns `:80/:443`. The `datxevui` stack joins the same overlay network; Caddy
  proxies `datxevui.com` → `datxevui_backend:8080` with automatic Let's
  Encrypt TLS. Deploy assets: `deploy/stack.yml`, `deploy/deploy.sh`,
  `deploy/Caddyfile.datxevui` (all synced by the `Deploy` workflow on every
  `v*` tag). Prerequisite: A records `datxevui.com` + `www.datxevui.com` →
  the server IP (Namecheap DNS today). Nothing is built on the server —
  GitHub Actions builds the image and pushes it to GHCR.

```
 users ──HTTPS──▶ Caddy (swarm, owns :80/:443, LE certs)
                     │  Host: datxevui.com
                     ▼
               datxevui_backend:8080  (overlay network pdf-tts_pdf-tts)
                     │  serves frontend/dist + API + WS
                     ├ /app/data   [vol]  rust-sql DB + OSM PBF
                     ├ /app/index  [vol]  Tantivy index (nested osm-index)
                     └ /app/storage[vol]  local uploads
```

- **B. Standalone Contabo + Cloudflare tunnel (fresh-server path):** the
  original cloudflared-outbound-only topology below — use it when deploying
  to a brand-new VPS with no existing reverse proxy:


```
                      ┌──────────────────────┐
   users ──HTTPS──▶   │      Cloudflare       │  DNS · CDN · WAF · TLS · DDoS
                      └──────────┬───────────┘
                                 │  (outbound-only tunnel — no open ports)
                      ┌──────────▼───────────┐        ┌──────────────────┐
                      │      cloudflared      │──────▶ │  Contabo VPS      │
                      └──────────┬───────────┘        │  Docker Compose   │
                                 │ http://backend:8080└──────────────────┘
                      ┌──────────▼───────────┐
                      │  backend (Rust)       │  serves frontend/dist + API + WS
                      │  ├ /app/data  [vol]   │  rust-sql DB + OSM PBF
                      │  ├ /app/index [vol]   │  Tantivy place-search index
                      │  └ /app/storage[vol]  │  local uploads
                      └──────────────────────┘
```

- **One image** — the Dockerfile builds the React/Vite frontend (bun) and the
  Rust backend into a single container; the backend serves the static bundle
  on `:8080` next to the API and WebSocket. No separate frontend hosting.
- **Cloudflare in front** — the `cloudflared` container holds an
  *outbound-only* tunnel to Cloudflare's edge. The VPS opens **zero inbound
  ports** (firewall allows SSH only): no port scans, no origin certificate
  management, WebSockets and SSE just work.
- **Tag-driven CI/CD** — push a `v*` tag to GitHub and
  `.github/workflows/deploy.yml` builds the image, pushes it to GHCR, and
  SSHes into the VPS to `docker compose up -d` with the new tag. The three
  volumes (rust-sql DB file, Tantivy index, uploads) persist across every release.

> Prefer classic proxied mode (orange-cloud A record, Caddy on 80/443)?
> See [§ Direct mode (Caddy)](#direct-mode-caddy--profile-direct) below.

---

## Contents

1. [Prerequisites](#prerequisites)
2. [One-time server setup (Contabo)](#one-time-server-setup-contabo)
3. [Cloudflare setup (tunnel + DNS)](#cloudflare-setup-tunnel--dns)
4. [GitHub repository settings](#github-repository-settings)
5. [First deploy](#first-deploy)
6. [Releasing (the daily workflow)](#releasing-the-daily-workflow)
7. [Tantivy index management](#tantivy-index-management)
8. [Operations (logs, restart, rollback, backups)](#operations)
9. [Direct mode (Caddy)](#direct-mode-caddy--profile-direct)
10. [Troubleshooting](#troubleshooting)
11. [TURN relay (WebRTC calls)](#turn-relay-webrtc-calls)
12. [Push (FCM) — ring when the app is closed](#push-fcm--ring-when-the-app-is-closed)

---

## TURN relay (WebRTC calls)

`turn.sh` (run by every `deploy.sh`, also safe standalone) keeps a
**coturn** STUN/TURN relay alive as a host-networked container
(`coturn-vexevn`). WebRTC audio calls between a customer and a staff
phone frequently involve one side on 5G (CGNAT) and the other behind
home-NAT — those paths can rarely hole-punch with STUN alone, so the
TURN relay is what makes calls actually connect (this was the root
cause of the "call stuck on connecting, dies after ~25 s" reports).

- Ports: `3478/tcp` + `3478/udp` (STUN+TURN) and `49160-49200/udp`
  (relay range) — open them in any edge firewall.
- Credentials: `TURN_USERNAME` (default `vexevn`) + `TURN_SECRET`
  (random hex, generated on the server into `/opt/vexevn/.env`, never
  committed).
- The backend picks up `AUDIO_CALL_ICE_SERVERS` from the same `.env`
  and pushes the STUN/TURN list to every peer in the `registered`
  frame over the authed WebSocket.
- Manual ops:
  ```bash
  bash /opt/vexevn/turn.sh            # (re)create + verify
  docker logs coturn-vexevn           # allocations + errors
  ```

### ⚠️ Provider firewall check (the silent TURN killer)

coturn can be perfectly healthy ON the server while unreachable from
the internet — cloud-provider firewall groups (Vultr/Contabo console,
etc.) silently drop everything except the ports you explicitly listed
(usually just 22/80/443). Symptoms: `stun` probes to `:3478` time out
from outside while `docker logs coturn-vexevn` shows zero errors and
the server answers itself locally. UFW rules are NOT enough — verify
from an external machine:

```bash
# From ANY external box — expect a "reply" line, not timeout:
python3 - <<'PY'
import socket, struct, secrets
txn = secrets.token_bytes(12)
req = struct.pack('!HHI', 0x0001, 0, 0x2112A442) + txn
s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); s.settimeout(4)
s.sendto(req, ('YOUR_SERVER_IP', 3478))
try:
    d, _ = s.recvfrom(2048); print('reply', len(d))
except socket.timeout:
    print('TIMEOUT — open 3478/udp+tcp and 49160-49200/udp in the PROVIDER console')
PY
```

Open these in the **provider console firewall group** (in addition to
UFW, which `turn.sh`/deploy already manage): `3478/udp`, `3478/tcp`,
`49160-49200/udp`.

## Push (FCM) — ring when the app is closed

The `/ws-call` WebSocket ring only reaches apps whose process is
alive. Two layers close that gap:

1. **Android duty mode (works today, no Firebase needed)** — the
   support app ships a native foreground service
   (`mobile/.../DutyModeService.kt`, `Chế độ trực` in settings) that
   keeps the process — and with it the signaling WebSocket + the
   local call-ring notification (full-screen intent) — alive after
   the app is swiped away. No server config needed.
2. **FCM data push (belt-and-braces + the only iOS path)** — the
   backend relays every ring (`incoming-call`) / cancellation
   (`call-ended`) to the agent's registered devices as high-priority
   FCM data messages. Stale tokens self-prune on 404/410.

Activating FCM:

- Create a Firebase project + Android app entry, download the
  service-account JSON (Project settings → Service accounts →
  Generate new private key).
- Add the whole JSON as ONE line to `/opt/vexevn/.env`:
  `FCM_CREDENTIALS_JSON=$(jq -c . service-account.json)` then
  `docker stack deploy` again (or the next release).
- Register devices: the app calls `POST /api/push/devices`
  `{ "token": "<fcm token>", "platform": "android" }` (mobile FCM
  wiring lands with the Firebase app id — see
  `mobile/README.md#push-notifications`).

## Prerequisites

| Item | Notes |
|---|---|
| Contabo VPS | 2 vCPU / 4 GB RAM is comfortable (Cloud 4 line). Ubuntu 22.04/24.04 recommended. |
| Domain on Cloudflare | Free plan is fine. Nameservers pointed at Cloudflare. |
| This GitHub repo | Default branch `master`; Actions enabled. |
| Tantivy index volume | Created automatically by compose; populate it with [`import-osm.sh`](#tantivy-index-management). |

## One-time server setup (Contabo)

SSH into the VPS, grab the deploy folder, run the bootstrap:

```bash
ssh root@<CONTABO_IP>

# Get the stack files (either clone the repo…)
git clone https://github.com/iamleson98/rust-be-template.git /tmp/repo
cd /tmp/repo/deploy

# …then bootstrap: installs Docker, writes /opt/vexevn/.env with a random
# JWT_SECRET, locks UFW to SSH-only, enables unattended security upgrades.
sudo bash server-init.sh
```

`server-init.sh` is **idempotent** — re-running never overwrites `.env`.
It prompts for the Cloudflare tunnel token (you can paste it later — see
the next section for where to get it).

What ends up where:

```
/opt/vexevn/
├── docker-compose.contabo.yml
├── Caddyfile.cloudflare          # only used in --profile direct
├── import-osm.sh
└── .env                          # 600, contains JWT_SECRET + TUNNEL_TOKEN
```

> **SSH key for CI**: while you're here, add the public half of a dedicated
> deploy key to `~/.ssh/authorized_keys` (the private half becomes the
> `SERVER_SSH_KEY` GitHub secret). A dedicated key is easy to revoke.

## Cloudflare setup (tunnel + DNS)

1. Cloudflare dashboard → **Zero Trust** → **Networks → Tunnels →
   Create a tunnel → Cloudflared**. Name it (e.g. `vexevn-contabo`).
2. Skip the "install connector" instructions — the `cloudflared` Docker
   container does that. Copy the **token** shown (it's long, starts with
   `eyJ...`).
3. Put the token on the VPS:
   ```bash
   nano /opt/vexevn/.env      # set TUNNEL_TOKEN=<paste>
   ```
4. Back in the tunnel config, **Public Hostname → Add**:
   - Subdomain / Domain: `vexevn.vn` (or whatever your domain is)
   - Service: **HTTP** `backend:8080` ← the compose service name
5. DNS is created automatically (CNAME to the tunnel). SSL/TLS mode can stay
   at the default — the tunnel is already end-to-end encrypted to Cloudflare.
6. Recommended free-plan extras:
   - **Security → Bots** and a basic WAF rule set
   - **Security → WAF → Rate limiting** (e.g. 300 req / 10 s per IP on
     `/api/*`) — this is your *per-client* rate limiting. The backend's own
     governor sees every request coming from the tunnel container IP, so its
     bucket is shared site-wide (that's why `.env` sets `RATE_LIMIT_RPM=6000`
     — it's a global safety net, not per-user).

## GitHub repository settings

**Settings → Secrets and variables → Actions → Secrets** (repository):

| Secret | Value |
|---|---|
| `SERVER_HOST` | Contabo VPS IP or hostname |
| `SERVER_USER` | SSH user (`root` or your admin user) |
| `SERVER_SSH_KEY` | contents of the deploy key's **private** key file |
| `GHCR_USER` *(optional)* | your GitHub username — only if the GHCR package is private |
| `GHCR_TOKEN` *(optional)* | a classic PAT with `read:packages` — only if private |

**Variables** (not secrets): `DEPLOY_DIR` = `/opt/vexevn` (default, optional).

> The GHCR package `ghcr.io/iamleson98/rust-be-template` — after the first
> release, open Packages → the image → Package settings → **Change
> visibility → Public** if you want passwordless pulls on the VPS (the repo
> itself is public anyway). Otherwise set `GHCR_USER`/`GHCR_TOKEN`.

## First deploy

Option A — let CI do everything (recommended):

```bash
# on your machine, from the repo root
git tag v0.1.0
git push origin v0.1.0
```

The **Deploy** workflow builds the image, pushes it to GHCR, syncs
`deploy/docker-compose.contabo.yml` to the VPS, pulls, and starts the stack
with a health-gate on `/health`.

Option B — boot manually on the VPS (image already on GHCR):

```bash
cd /opt/vexevn
APP_IMAGE=ghcr.io/iamleson98/rust-be-template:latest \
  docker compose -f docker-compose.contabo.yml up -d
docker compose -f docker-compose.contabo.yml ps
```

Then:

- Visit `https://yourdomain/` — register the first account; it becomes the
  **admin** automatically.
- Build the Tantivy place index: `bash import-osm.sh` (see below).

## Releasing (the daily workflow)

```bash
git tag v1.2.3 && git push origin v1.2.3
```

That's it. The pipeline:

1. **build-and-push** — cargo-chef-cached Rust release build + Vite frontend
   build in one image; tagged `1.2.3`, `1.2`, `latest`, `commit-<sha>` on GHCR.
2. **deploy** — SSH to the VPS → `docker compose pull backend` →
   `APP_IMAGE=<exact tag> docker compose up -d` → wait up to 90 s for
   `/health` → print rollback instructions on failure.

Every release pins the exact image tag on the server, so `latest` drift
never bites you, and the previous image name is echoed in the job log for
one-command rollback (see below). Deploys serialize via a concurrency group.
Expect a ~5–15 s blip while the single backend container is recreated —
fine at this scale; scale-out paths are documented in the root
`DEPLOYMENT.md`.

## Tantivy index management

The place-search index is a **volume**, deliberately laid out like this:

```
osm-index volume → /app/index/
├── osm-index/            ← live index (SEARCH_INDEX_DIR)
├── osm-index.staging/    ← importer's build dir
└── osm-index.old/        ← previous live index after a swap
```

The nesting is **required**, not cosmetic: the importer builds into
`osm-index.staging` and atomically `rename(2)`s it over `osm-index`.
Siblings share the volume's filesystem — a flattened layout (`/app/osm-index`
as the mount point) would put staging on the container's overlay FS and
every swap would fail with **EXDEV**.

Two ways to populate it:

**One-off (recommended for a new server):**

```bash
cd /opt/vexevn && bash import-osm.sh
# → downloads the ~500 MB Geofabrik Vietnam extract into the app-data
#   volume (resumable), indexes into staging, swaps, restarts backend,
#   waits for /health.
```

**Hands-off (biweekly):** the backend's own scheduler already knows how to
do this — with `SCHEDULER_ENABLED=true` the seeded `osm.import` job
downloads, indexes, swaps, **and hot-reloads** the index without a restart
(view/trigger it from the admin cron-jobs page). `import-osm.sh` is just the
manual escape hatch.

## Operations

```bash
cd /opt/vexevn
COMPOSE="docker compose -f docker-compose.contabo.yml"

$COMPOSE ps                          # status
$COMPOSE logs -f --tail 100 backend  # follow logs
$COMPOSE logs --tail 50 cloudflared  # tunnel logs
$COMPOSE restart backend             # graceful restart (30s drain)

# rollback — pin any older tag:
APP_IMAGE=ghcr.io/iamleson98/rust-be-template:1.2.2 $COMPOSE up -d
```

**Backups** (all state lives in three named volumes):

```bash
# Topology A (CURRENT — swarm stack `datxevui`, volumes are stack-scoped):
docker service scale datxevui_backend=0        # stop writes (edge gives 502-ish blip)
docker run --rm -v datxevui_vexevn-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/app-data-$(date +%F).tgz -C /data .
docker run --rm -v datxevui_vexevn-storage:/data -v $(pwd):/backup alpine \
  tar czf /backup/app-storage-$(date +%F).tgz -C /data .
docker service scale datxevui_backend=1        # back online
# NOTE the historic "vexevn-" prefix inside the volume names: the stack
# rename (vexevn → datxevui, 2026-09-08) changed the STACK prefix only.
# 2026-09-08 post-mortem: that rename silently created fresh empty
# datxevui_vexevn-* volumes while production data stayed in the old
# vexevn_vexevn-* ones — recovered by draining the service and copying
# volume contents across; verified before switching the Caddy upstream.

# Topology B (standalone compose):
# stop writes, snapshot, restart (≈15 s downtime)
$COMPOSE stop backend
docker run --rm -v vexevn_app-data:/data -v $(pwd):/backup alpine \
  tar czf /backup/app-data-$(date +%F).tgz -C /data .
docker run --rm -v vexevn_osm-index:/data -v $(pwd):/backup alpine \
  tar czf /backup/osm-index-$(date +%F).tgz -C /data .
$COMPOSE start backend
```

(The Tantivy index is rebuildable from the PBF — you can skip its backup if
disk is tight. The rust-sql DB file in `app-data` is the crown jewel.)

## Direct mode (Caddy, `--profile direct`)

If you'd rather not use a tunnel: open ports 80/443, point a proxied
(proxied-cloud) DNS A record at the VPS, set SSL/TLS mode to **Full
(strict)**, and drop a Cloudflare **Origin CA certificate** into
`deploy/certs/` (`origin.pem` + `origin.key`, created in the dash under
SSL/TLS → Origin Server; valid ~15 years).

```bash
# at bootstrap time:
sudo bash server-init.sh --direct          # opens 80/443 in UFW

# at runtime:
DOMAIN=yourdomain.com $COMPOSE --profile direct up -d
```

`Caddyfile.cloudflare` restores the real client IP from
`CF-Connecting-IP` and streams SSE/WebSocket without buffering. The tunnel
is still the recommended mode (no certs, no exposed ports).

## Troubleshooting

| Symptom | Fix |
|---|---|
| `cloudflared` log: `failed to connect to origin` | Backend unhealthy: `$COMPOSE logs backend`. It waits for `service_healthy` before starting — check it started at all. |
| Site loads but search returns nothing | Tantivy index is empty — run `bash import-osm.sh`, then confirm `SEARCH_INDEX_DIR=/app/index/osm-index` in `.env`. |
| 502 from Cloudflare after deploy | Health gate failed in CI — check the Actions log tail of backend logs; rollback with `APP_IMAGE=<previous> $COMPOSE up -d`. |
| `pull access denied` for image on the VPS | GHCR package is private — make it public, or set `GHCR_USER`/`GHCR_TOKEN` GitHub secrets. |
| Can't SSH after UFW enable | Use the Contabo web console/VNC; `ufw allow OpenSSH` then `ufw reload`. |
| Deploy workflow skipped the deploy job | `SERVER_HOST` secret not set in the repo — the job prints a notice and only builds/pushes. |
| Rate-limit 429s for everyone at once | Backend governor is site-wide behind the tunnel — raise `RATE_LIMIT_RPM` in `.env`, add a Cloudflare WAF rate rule for per-client limits. |
