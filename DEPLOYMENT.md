# Deployment & Configuration Guide — VeXeVN

Complete guide for deploying the full stack (Rust backend + React frontend + rust-sql database + Redis + Caddy + NullClaw AI) to a VM using Docker.

> ### ⭐ Recommended path: Contabo + Cloudflare Tunnel + tag-driven CI/CD
>
> The current production stack deploys to a **Contabo VPS** with **Cloudflare**
> in front (outbound-only tunnel — zero open ports) and releases via **GitHub
> Actions on `v*` tags**: `git tag v1.2.3 && git push origin v1.2.3` builds the
> single Docker image (frontend built inside, served by the backend), pushes
> it to GHCR, and SSHes into the VPS to roll it out. The Tantivy place-search
> index persists on its own volume across releases.
>
> **Runbook: [`deploy/README.md`](deploy/README.md)** · stack:
> [`deploy/docker-compose.contabo.yml`](deploy/docker-compose.contabo.yml) ·
> bootstrap: [`deploy/server-init.sh`](deploy/server-init.sh) · pipeline:
> [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)
>
> The Swarm/Kamatera path below (§3, §13) remains as the Redis
> scale-out alternative.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Prerequisites](#2-prerequisites)
3. [Quick Start: Deploy to Kamatera](#3-quick-start-deploy-to-kamatera)
4. [Environment Variables Reference](#4-environment-variables-reference)
5. [Database (rust-sql engine)](#5-database-rust-sql-engine)
6. [NullClaw AI Chat Assistant](#6-nullclaw-ai-chat-assistant)
7. [Payment Gateways](#7-payment-gateways)
8. [OAuth 2.0 (Google / Facebook / Twitter)](#8-oauth-20-google--facebook--twitter)
9. [Place Search (OSM / Tantivy)](#9-place-search-osm--tantivy)
10. [Caddy Reverse Proxy & TLS](#10-caddy-reverse-proxy--tls)
11. [Audio Calls (WebRTC)](#11-audio-calls-webrtc)
12. [PWA & SEO](#12-pwa--seo)
13. [Docker Swarm Operations](#13-docker-swarm-operations)
14. [Backup & Recovery](#14-backup--recovery)
15. [CI/CD Pipeline](#15-cicd-pipeline)
16. [Troubleshooting](#16-troubleshooting)
17. [Local Development](#17-local-development)

---

## 1. Architecture Overview

```
                    ┌─────────────────────────────────┐
                    │  Internet                        │
                    └──────────┬───────────────────────┘
                               │
                    ┌──────────▼───────────────────────┐
                    │  Caddy (TLS, :80/:443)           │
                    │  - Let's Encrypt auto-cert       │
                    │  - Reverse proxy → backend:8080   │
                    │  - Security headers (CSP, HSTS)   │
                    │  - WebSocket upgrade (automatic)  │
                    └──────────┬───────────────────────┘
                               │  Docker network: vexevn-net
                    ┌──────────▼───────────────────────┐
                    │  Backend (Rust/Axum :8080)       │
                    │  - REST API (/api/*)              │
                    │  - WebSocket (/ws, /ws-call)      │
                    │  - Static files (frontend/dist)    │
                    │  - Auto-migrations on startup      │
                    └────┬─────────┬──────────┬─────────┘
                         │         │          │
              ┌─────────────┐ ┌───▼────┐ ┌───▼──────────┐
              │  rust-sql   │ │ Redis  │ │  NullClaw    │
              │  (in-binary │ │(:6379) │ │  (:42617)    │
              │  rustqlite) │ │ - cache│ │  - Gemini AI │
              │  - app-data │ │ - jobs │ │  - Optional   │
              └─────────────┘ └────────┘ └──────────────┘
```

**Single binary**: The Rust backend serves the API, WebSocket hub, and static frontend files from a single process. No separate frontend server needed in production.

**Docker Swarm**: All services run as Swarm services on a single VM. Caddy handles TLS termination. The database is the rust-sql engine compiled INTO the backend binary (no DB container); Redis is internal-only (no public ports). NullClaw is optional (profile-gated).

---

## 2. Prerequisites

### Kamatera VM
- **Size**: A-4GB (4 GB RAM, 2 vCPU) minimum. A-8GB recommended for production.
- **OS**: Ubuntu 22.04 LTS
- **Region**: Asia-Singapore (closest to Vietnam)
- **Disk**: 50 GB SSD minimum (database files + Redis + app storage + Docker images)

### Domain
- A domain name (e.g. `vexevn.vn`) with DNS A record pointing to the VM's public IP.
- Caddy auto-provisions Let's Encrypt TLS certificates — just point the DNS.

### Software on the VM
```bash
# Install Docker + Swarm
curl -fsSL https://get.docker.com | sh
docker swarm init --advertise-addr <VM_PRIVATE_IP>

# Verify
docker info | grep "Swarm: active"
```

### GitHub (for CI/CD — optional)
- Repository with push access to the `server` branch.
- GitHub Container Registry (GHCR) — auto-provided via `GITHUB_TOKEN`.
- GitHub Secrets: `VM_HOST`, `VM_SSH_KEY`, `VM_USER` (for auto-deploy).

---

## 3. Quick Start: Deploy to Kamatera

### Step 1: SSH into the VM

```bash
ssh root@<VM_PUBLIC_IP>
```

### Step 2: Create the project directory

```bash
mkdir -p /opt/vexevn
cd /opt/vexevn
```

### Step 3: Create `.env` from the example

```bash
# Copy the example (or create from scratch)
cat > .env << 'ENVEOF'
# ── Server ──────────────────────────────────────────
SERVER_HOST=0.0.0.0
SERVER_PORT=8080
RUST_LOG=info,backend=info,tower_http=warn

# ── Database (rust-sql engine — the only backend) ───
DATABASE_URL=sqlite:///app/data/app.db?mode=rwc
DATABASE_MAX_CONNECTIONS=20
DATABASE_MIN_CONNECTIONS=5

# ── Redis ───────────────────────────────────────────
REDIS_PASSWORD=CHANGE_ME_STRONG_PASSWORD

# ── JWT (generate with: openssl rand -hex 32) ───────
JWT_SECRET=CHANGE_ME_TO_64_HEX_CHARS

# ── Cookies ─────────────────────────────────────────
COOKIE_DOMAIN=
COOKIE_SECURE=true
COOKIE_SAMESITE=lax

# ── Cache + Worker ──────────────────────────────────
CACHE_BACKEND=redis
CACHE_REDIS_URL=redis://redis:6379/0
WORKER_BACKEND=redis
WORKER_REDIS_URL=redis://redis:6379/1

# ── CORS (your domain) ──────────────────────────────
CORS_ORIGINS=https://yourdomain.com

# ── Static files ────────────────────────────────────
STATIC_FILES_DIR=./frontend/dist

# ── Rate limiting ───────────────────────────────────
RATE_LIMIT_RPM=600
RATE_LIMIT_BURST=100

# ── WebSocket ───────────────────────────────────────
WS_MAX_CONNECTIONS=50000
WS_HEARTBEAT_SEC=30
WS_IDLE_TIMEOUT_SEC=90

# ── NullClaw (disabled by default) ──────────────────
NULLCLAW_ENABLED=false
NULLCLAW_API_URL=http://nullclaw:42617
NULLCLAW_API_KEY=
NULLCLAW_MODEL=gemini-2.0-flash

# ── Audio calls (disabled by default) ───────────────
AUDIO_CALL_ENABLED=false

# ── Contact info ────────────────────────────────────
CONTACT_PHONE=+8419006067
CONTACT_EMAIL=hotro@vexevn.vn
CONTACT_ADDRESS=123 Lê Lợi, Q.1, TP.HCM

# ── OAuth (disabled by default) ──────────────────────
OAUTH_REDIRECT_BASE_URL=https://yourdomain.com
OAUTH_FRONTEND_URL=https://yourdomain.com
OAUTH_GOOGLE_ENABLED=false
OAUTH_FACEBOOK_ENABLED=false
OAUTH_TWITTER_ENABLED=false

# ── Payments (disabled by default) ──────────────────
PAYMENT_COD_ENABLED=true
VNPAY_ENABLED=false
MOMO_ENABLED=false
ZALOPAY_ENABLED=false
VIETQR_ENABLED=false
ENVEOF
```

**Generate a strong JWT secret**:
```bash
openssl rand -hex 32
# Paste the output into JWT_SECRET above
```

**Generate strong passwords**:
```bash
openssl rand -hex 16  # For REDIS_PASSWORD
```

### Step 4: Create the Caddyfile

```bash
cat > Caddyfile << 'CADDYEOF'
yourdomain.com {
    encode zstd gzip

    reverse_proxy backend:8080 {
        header_up X-Real-IP {remote_host}
        header_up X-Forwarded-For {remote_host}
        header_up X-Forwarded-Proto {scheme}
        flush_interval -1
    }

    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains; preload"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "SAMEORIGIN"
        Referrer-Policy "strict-origin-when-cross-origin"
        -Server
    }

    log {
        output file /data/access.log {
            roll_size 100mb
            roll_keep 10
        }
        format json
    }
}
CADDYEOF
```

**Replace `yourdomain.com` with your actual domain.**

### Step 5: Download docker-compose.prod.yml

Either copy from the repo or create it:

```bash
# If you cloned the repo:
cp /path/to/repo/docker-compose.prod.yml .

# Or download from GitHub:
curl -O https://raw.githubusercontent.com/iamleson98/rust-be-template/server/docker-compose.prod.yml
```

### Step 6: Deploy

```bash
# Log in to GHCR (if using a private image):
echo $GITHUB_TOKEN | docker login ghcr.io -u iamleson98 --password-stdin

# Deploy the stack:
docker stack deploy -c docker-compose.prod.yml --with-registry-auth vexevn

# Check status:
docker service ls
# NAME             MODE     REPLICAS  IMAGE
# vexevn_backend   replicated 1/1     ghcr.io/iamleson98/vexevn:latest
# vexevn_redis     replicated 1/1     redis:7-alpine
# vexevn_caddy     replicated 1/1     caddy:2-alpine

# Check health:
curl -sf http://localhost:8080/health
# {"status":"ok","version":"0.1.0"}

# Check Caddy (should redirect to HTTPS):
curl -I http://localhost
# HTTP/1.1 301 Moved Permanently
# Location: https://yourdomain.com/
```

### Step 7: Deploy WITH NullClaw AI (optional)

```bash
# Add NullClaw-specific env vars to .env:
echo 'NULLCLAW_ENABLED=true' >> .env
echo 'NULLCLAW_API_KEY=your-shared-secret-key' >> .env
echo 'GEMINI_API_KEY=your-gemini-api-key' >> .env
echo 'LLM_PROVIDER=openai' >> .env

# Re-deploy with the nullclaw profile:
docker stack deploy -c docker-compose.prod.yml --with-registry-auth --profile nullclaw vexevn

# Verify NullClaw is running:
docker service ls | grep nullclaw
# vexevn_nullclaw  replicated 1/1  ghcr.io/nullclaw-labs/nullclaw:latest

# Check NullClaw status via the backend:
curl -sf http://localhost:8080/api/nullclaw/status
# {"enabled":true,"provider":"http"}
```

### Step 8: Verify the deployment

```bash
# HTTPS should work:
curl -sf https://yourdomain.com/health
# {"status":"ok","version":"0.1.0"}

# API docs (Swagger UI):
open https://yourdomain.com/swagger-ui

# Frontend loads:
curl -sf https://yourdomain.com/ | head -5
# <!DOCTYPE html><html lang="vi">...
```

---

## 4. Environment Variables Reference

All variables are documented in `.env.example`. Here's a summary by section:

### Server
| Variable | Default | Description |
|---|---|---|
| `SERVER_HOST` | `0.0.0.0` | Bind address |
| `SERVER_PORT` | `8080` | Listen port |
| `RUST_LOG` | `info,backend=info` | Log level (RUST_LOG syntax) |
| `SERVER_REQUEST_TIMEOUT_SECS` | `30` | Per-request timeout |
| `SERVER_MAX_REQUEST_BODY_BYTES` | `2097152` | Max body size (2 MiB) |
| `SERVER_VALHALLA_URL` | (empty) | Valhalla routing proxy URL |

### Database
| Variable | Default | Description |
|---|---|---|
| `DATABASE_URL` | `sqlite://./app.db?mode=rwc` | rust-sql (rustqlite) database URL — sqlite:// scheme |
| `DATABASE_MAX_CONNECTIONS` | `20` | Pool max |
| `DATABASE_MIN_CONNECTIONS` | `5` | Pool min |

### JWT
| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | (must set) | HS256 signing key — **≥32 bytes**. Generate with `openssl rand -hex 32` |
| `JWT_ACCESS_TTL_SECS` | `900` | Access token TTL (15 min) |
| `JWT_REFRESH_TTL_SECS` | `604800` | Refresh token TTL (7 days) |

### Cookie
| Variable | Default | Description |
|---|---|---|
| `COOKIE_DOMAIN` | (empty) | Empty = same-origin. Set for cross-subdomain |
| `COOKIE_SECURE` | `false` | **Set `true` in production** (HTTPS only) |
| `COOKIE_SAMESITE` | `lax` | `lax` | `strict` | `none` |

### Cache + Worker
| Variable | Default | Description |
|---|---|---|
| `CACHE_BACKEND` | `moka` | `moka` (in-process) or `redis` (shared) |
| `CACHE_REDIS_URL` | `redis://127.0.0.1:6379/0` | Redis URL (when `CACHE_BACKEND=redis`) |
| `WORKER_BACKEND` | `redis` | `redis` | `db` | `kafka` |
| `WORKER_REDIS_URL` | `redis://127.0.0.1:6379/1` | Redis URL for job queue |

### CORS
| Variable | Default | Description |
|---|---|---|
| `CORS_ORIGINS` | `http://localhost:3000,...` | Comma-separated allowed origins. **Set to your domain in production** |

### WebSocket
| Variable | Default | Description |
|---|---|---|
| `WS_MAX_CONNECTIONS` | `50000` | Max concurrent WS connections |
| `WS_MAX_PER_IP` | `10` | Max connections per IP |
| `WS_HEARTBEAT_SEC` | `30` | Ping interval |
| `WS_IDLE_TIMEOUT_SEC` | `90` | Disconnect after N seconds of inactivity |

### NullClaw AI
| Variable | Default | Description |
|---|---|---|
| `NULLCLAW_ENABLED` | `false` | Enable AI chat replies |
| `NULLCLAW_API_URL` | (empty) | NullClaw container URL (e.g. `http://nullclaw:42617`) |
| `NULLCLAW_API_KEY` | (empty) | Shared secret between backend and NullClaw |
| `NULLCLAW_MODEL` | `nullclaw-default` | LLM model name (e.g. `gemini-2.0-flash`) |
| `NULLCLAW_TIMEOUT_MS` | `15000` | Request timeout |
| `NULLCLAW_MAX_HISTORY` | `12` | Conversation history sliding window |
| `NULLCLAW_FALLBACK_ONLINE_EMPLOYEES` | `1` | AI replies only when <N employees online |

### Redis (docker-compose only)
| Variable | Description |
|---|---|
| `REDIS_PASSWORD` | Redis password (**must set**) |

### NullClaw LLM Provider
| Variable | Default | Description |
|---|---|---|
| `LLM_PROVIDER` | `openai` | LLM provider for the NullClaw container |
| `GEMINI_API_KEY` | (empty) | Google Gemini API key (via OpenAI-compatible endpoint) |

### Payment Gateways
See [section 7](#7-payment-gateways) below.

### OAuth
See [section 8](#8-oauth-20-google--facebook--twitter) below.

---

## 5. Database (rust-sql engine)

### The only engine

The database is **rust-sql** (`rustqlite`) — a pure-Rust SQLite-dialect
engine compiled INTO the backend binary. sea-orm speaks its sqlite
dialect through sqlx-sqlite, and every `sqlite3_*` FFI call lands in
the rustqlite engine via the C-ABI compat layer (the `[patch.crates-io]`
libsqlite3-sys redirect in `Cargo.toml`).

- **No C SQLite** in the image — not even the `sqlite3` CLI.
- **No Postgres backend** — the former `sqlite`/`postgres` cargo
  features were removed; every build links rust-sql.
- **No DB container** — the database is a file on the `app-data`
  volume (`/app/data/app.db`), WAL mode on.
- The engine is a git submodule: `git submodule update --init --recursive`
  after clone (CI/Docker do this automatically).

### `DATABASE_URL`

The URL scheme is `sqlite://` (the dialect the engine speaks):

```bash
DATABASE_URL=sqlite:///app/data/app.db?mode=rwc
```

### Migrations

**Migrations auto-run** on `backend serve` startup (23 migrations). No manual step needed.

### Running migrations manually

```bash
# Standalone migrator binary:
./migrator up

# Or via the backend CLI:
./backend serve --no-migrate  # skip auto-migrate
./backend migrate up          # run migrations only, then exit

# Check migration status:
./migrator list
```

---

## 6. NullClaw AI Chat Assistant

NullClaw is the AI-powered customer support bot. When no human agent is online, it answers customer questions about bookings, payments, routes, and more.

### Architecture

```
Customer sends message → WebSocket hub → Check: are employees online?
  ├─ YES → Just notify employees (notification badge + sound)
  └─ NO  → Send typing indicator → Call NullClaw API → Broadcast AI reply
```

### Enable NullClaw

1. **Get a Gemini API key** (free tier available):
   - Go to [Google AI Studio](https://aistudio.google.com/)
   - Create an API key
   - Set it as `GEMINI_API_KEY` in your `.env`

2. **Configure `.env`**:
```bash
NULLCLAW_ENABLED=true
NULLCLAW_API_URL=http://nullclaw:42617
NULLCLAW_API_KEY=your-shared-secret
NULLCLAW_MODEL=gemini-2.0-flash
GEMINI_API_KEY=your-gemini-api-key
LLM_PROVIDER=openai
```

3. **Deploy with the nullclaw profile**:
```bash
docker stack deploy -c docker-compose.prod.yml --with-registry-auth \
  --profile nullclaw vexevn
```

4. **Verify**:
```bash
curl -sf http://localhost:8080/api/nullclaw/status
# {"enabled":true,"provider":"http"}
```

### NullClaw behavior configuration (`nullclaw.config.json`)

The `nullclaw.config.json` file (mounted into the NullClaw container) configures:
- **System prompt**: Vietnamese-language VeXeVN support assistant persona
- **Safety**: blocks prompt injection (`ignore previous instructions`, `jailbreak`, etc.)
- **Domain keywords**: only triggers AI for booking-related queries
- **Rate limit**: 20 req/min, 200 req/hour per user
- **Conversation**: 12-message sliding window
- **Fallback**: hands off to human when question is complex

### How the bot user works

- On **first user signup**, `AuthService::register` auto-creates a bot user (`nullclaw_agent@example.com`, role=`employee`).
- The bot's UUID is looked up by email and cached in a `OnceCell` (looked up once per boot).
- On **channel creation**, the bot is auto-added as a channel member (`role='bot'`).
- AI replies are stored as `ChatMessage` rows with `senderType='assistant'` and `senderId=<bot UUID>`.
- Audit log: every AI reply is also written to the `null_claw_exchange` table (prompt, completion, model, latency, confidence).

---

## 7. Payment Gateways

### Supported providers

| Provider | Type | Env prefix | Status |
|---|---|---|---|
| **VNPay** | Redirect payment | `VNPAY_*` | Implemented |
| **MoMo** | API payment | `MOMO_*` | Implemented |
| **ZaloPay** | API payment | `ZALOPAY_*` | Implemented |
| **VietQR** | Static QR (EMV) | `VIETQR_*` | Implemented |
| **COD** | Cash on delivery | `PAYMENT_COD_ENABLED` | Enabled by default |

### Configuration

Each provider has its own env block. Example for VNPay:

```bash
# VNPay
VNPAY_ENABLED=true
VNPAY_ENV=sandbox          # or 'production'
VNPAY_TMN_CODE=YOUR_CODE
VNPAY_HASH_SECRET=YOUR_SECRET
```

**Common settings**:
```bash
PAYMENT_PUBLIC_BASE_URL=https://yourdomain.com  # For return URLs
PAYMENT_DEFAULT_EXPIRY_MINUTES=10              # Hold expires after 10 min
PAYMENT_COD_ENABLED=true                       # Cash on delivery
```

### Testing in sandbox

Each provider has a sandbox environment. Set `<PROVIDER>_ENV=sandbox` and use the sandbox credentials from the provider's developer portal.

### IPN webhooks

Payment gateway callbacks (IPN) are handled at:
- `GET /api/payments/ipn/vnpay` (VNPay)
- `POST /api/payments/ipn/momo` (MoMo)
- `POST /api/payments/ipn/zalopay` (ZaloPay)

These are HMAC-verified — forged callbacks are rejected. The `/ipn/` path is exempt from the anti-scraping Origin check.

---

## 8. OAuth 2.0 (Google / Facebook / Twitter)

### Setup

1. **Create OAuth app** at each provider:
   - **Google**: [Google Cloud Console](https://console.cloud.google.com/apis/credentials)
   - **Facebook**: [Facebook Developers](https://developers.facebook.com/)
   - **Twitter/X**: [Twitter Developer Portal](https://developer.twitter.com/)

2. **Set redirect URI** to:
   ```
   https://yourdomain.com/api/auth/oauth/google/callback
   https://yourdomain.com/api/auth/oauth/facebook/callback
   https://yourdomain.com/api/auth/oauth/twitter/callback
   ```

3. **Configure `.env`**:
```bash
OAUTH_REDIRECT_BASE_URL=https://yourdomain.com
OAUTH_FRONTEND_URL=https://yourdomain.com

# Google
OAUTH_GOOGLE_ENABLED=true
OAUTH_GOOGLE_CLIENT_ID=your-client-id
OAUTH_GOOGLE_CLIENT_SECRET=your-client-secret
OAUTH_GOOGLE_SCOPES=openid,profile,email

# Facebook
OAUTH_FACEBOOK_ENABLED=true
OAUTH_FACEBOOK_CLIENT_ID=your-client-id
OAUTH_FACEBOOK_CLIENT_SECRET=your-client-secret

# Twitter/X
OAUTH_TWITTER_ENABLED=true
OAUTH_TWITTER_CLIENT_ID=your-client-id
OAUTH_TWITTER_CLIENT_SECRET=your-client-secret
```

### Flow

1. Frontend redirects to `GET /api/auth/oauth/{provider}/start`
2. Backend sets a state cookie + redirects to the provider
3. Provider redirects back to `GET /api/auth/oauth/{provider}/callback?code=...&state=...`
4. Backend verifies state, exchanges code for user info, creates/links user
5. Backend sets auth cookies + redirects to frontend

---

## 9. Place Search (OSM / Tantivy)

The place search uses a **Tantivy fulltext index** built from OpenStreetMap PBF data. This powers the autocomplete in the search bar.

### Building the index (optional but recommended)

```bash
# 1. Download Vietnam OSM data (~500 MB):
./scripts/download-vietnam-osm.sh

# 2. Build the Tantivy index:
./backend import-osm ./data/vietnam-latest.osm.pbf --index-dir ./osm-index

# 3. Mount the index in the container:
# The docker-compose.prod.yml already mounts app-osm:/app/osm-index
# Copy the built index into the volume:
docker cp ./osm-index $(docker ps -qf name=vexevn_backend):/app/osm-index
```

### Without the index

If the Tantivy index is missing, the backend falls back to SQL `LIKE` queries on the `places` table. This is slower but still works. The `places` table is seeded with major Vietnamese cities during migration.

---

## 10. Caddy Reverse Proxy & TLS

### What Caddy does

- **TLS**: Auto-provisions + renews Let's Encrypt certificates
- **Reverse proxy**: Forwards all traffic to the backend on `:8080`
- **WebSocket**: Automatic upgrade (no special config)
- **Security headers**: HSTS, CSP, X-Frame-Options, etc.
- **Compression**: zstd + gzip auto-negotiated
- **Static caching**: Immutable assets cached for 1 year
- **HTTP→HTTPS redirect**: Automatic
- **Access logs**: JSON-formatted with rotation

### Caddyfile setup

Before deploying, **replace `yourdomain.com`** in the `Caddyfile`:

```bash
sed -i 's/yourdomain.com/vexevn.vn/g' Caddyfile
```

The `Caddyfile` is mounted into the Caddy container at `/etc/caddy/Caddyfile:ro`.

### Firewall

```bash
# Allow HTTP + HTTPS
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp  # HTTP/3 (QUIC)

# Block direct access to backend (only Caddy should reach it)
ufw deny 8080/tcp
```

---

## 11. Audio Calls (WebRTC)

Audio calls use a WebRTC signaling relay at `/ws-call`. Disabled by default.

### Enable

```bash
AUDIO_CALL_ENABLED=true

# STUN/TURN servers (required for NAT traversal):
AUDIO_CALL_ICE_SERVERS=[{"urls":"stun:stun.l.google.com:19302"}]

# For production behind NAT, use a TURN server:
AUDIO_CALL_ICE_SERVERS=[{"urls":"turn:turn.yourdomain.com:3478","username":"user","credential":"pass"}]
```

### Requirements

- A TURN server (e.g. [coturn](https://github.com/coturn/coturn)) if either party is behind a symmetric NAT.
- UDP ports 49152-65535 open on the firewall for TURN relay traffic.

---

## 12. PWA & SEO

### PWA

- **Manifest**: `frontend/public/manifest.webmanifest` — Vietnamese language, blue theme, standalone display.
- **Service worker**: `/sw.js` — served with `Service-Worker-Allowed: /` header.
- **Icons**: Generated by `frontend/scripts/gen-icons.mjs` from `logo.svg` during Docker build.
- **Offline page**: `offline.html` fallback when network is down.

### SEO

- **Prerendering**: `frontend/prerender.mjs` runs during Docker build — `index.html` is pre-rendered with GA4 + Google Search Console tags injected.
- **Sitemap**: `GET /sitemap.xml` — lists all static routes.
- **Robots.txt**: `GET /robots.txt` — allows search engines, blocks `/api/`, `/admin/`.
- **JSON-LD**: Structured data (FAQ, Organization, WebSite) embedded in prerendered HTML.

### Analytics (build-time)

Pass these as Docker build args:
```bash
docker build \
  --build-arg VITE_GA4_ID=G-XXXXXXXXXX \
  --build-arg VITE_GSC_VERIFICATION=your-token \
  -t vexevn:latest .
```

---

## 13. Docker Swarm Operations

### Useful commands

```bash
# List services:
docker service ls

# View logs:
docker service logs vexevn_backend --tail 100 -f
docker service logs vexevn_caddy --tail 50 -f

# Restart a service:
docker service update --force vexevn_backend

# Scale a service (e.g. 2 backend replicas):
docker service scale vexevn_backend=2

# Rollback to previous version:
docker service rollback vexevn_backend

# Update image:
docker service update --image ghcr.io/iamleson98/vexevn:latest vexevn_backend

# Remove the entire stack:
docker stack rm vexevn
```

### Zero-downtime updates

The `deploy.update_config` in `docker-compose.prod.yml` is set to:
```yaml
update_config:
  parallelism: 1
  delay: 10s
  failure_action: rollback
  order: start-first    # New task starts BEFORE old one stops
```

This means: when you update the image, Swarm starts the new container first, waits for it to pass the health check, then stops the old container. No downtime.

### Adding the NullClaw profile

```bash
# Deploy WITHOUT NullClaw (default):
docker stack deploy -c docker-compose.prod.yml --with-registry-auth vexevn

# Deploy WITH NullClaw:
docker stack deploy -c docker-compose.prod.yml --with-registry-auth --profile nullclaw vexevn
```

---

## 14. Backup & Recovery

### Database backup

The database is a file (plus its WAL) on the `app-data` volume —
back it up by copying the file while the WAL is checkpointed:

```bash
# Manual backup (run inside the backend container, engine quiesced):
docker exec $(docker ps -qf name=vexevn_backend)   sh -c 'curl -sf http://localhost:8080/health >/dev/null && cp /app/data/app.db /app/data/backup_$(date +%Y%m%d).db'

# Or snapshot the volume from the host:
docker run --rm -v vexevn_app-data:/data -v $(pwd):/backup alpine   cp /data/app.db /backup/backup_$(date +%Y%m%d).db

# Restore: stop the stack, replace app.db, start the stack.
```

### Automated daily backup (cron)

```bash
# Add to crontab:
0 3 * * * docker exec $(docker ps -qf name=vexevn_db) pg_dump -U app vexevn | gzip > /opt/vexevn/backups/db_$(date +\%Y\%m\%d).sql.gz && find /opt/vexevn/backups -mtime +7 -delete
```

### Volume backup

```bash
# List volumes:
docker volume ls | grep vexevn

# Backup app-storage (uploaded files):
docker run --rm -v vexevn_app-storage:/data -v /opt/vexevn/backups:/backup alpine tar czf /backup/storage.tar.gz /data
```

---

## 15. CI/CD Pipeline

### GitHub Actions workflow

The CI pipeline (`.github/workflows/ci.yml`) runs on every push/PR:

| Job | What it does |
|---|---|
| `backend` | `cargo fmt --check` → `cargo check` → `cargo clippy` → `cargo test` |
| `backend-audit` | `cargo audit` (CVE scan) |
| `frontend` | `bun install` → `tsc --noEmit` → `vitest run` → `vite build` |
| `secrets-scan` | gitleaks (full git history scan) |
| `docker-build` | Docker build smoke test (no push) |

### Auto-deploy (`.github/workflows/deploy.yml`)

**Tag-driven releases (current):** on pushing a `v*` tag
(`git tag v1.2.3 && git push origin v1.2.3`):
1. Builds the single Docker image — frontend (Vite/bun) + backend (the
   rust-sql engine is compiled in unconditionally — no feature flags)
2. Pushes to GHCR tagged `1.2.3`, `1.2`, `latest`, `commit-<sha>`
3. SCPs `deploy/docker-compose.contabo.yml` (+ Caddyfile, import-osm.sh)
   to the VPS
4. SSHes in and runs `APP_IMAGE=<exact tag> docker compose up -d`, then
   waits for `/health` and prints a one-line rollback on failure

Full runbook: [`deploy/README.md`](deploy/README.md). The legacy branch-push
flow (`server` branch → Swarm) has been superseded; the Swarm compose file
(`docker-compose.prod.yml`) is still maintained for scale-out.

### Required GitHub secrets (Contabo path)

| Secret | Value |
|---|---|
| `SERVER_HOST` | Contabo VPS public IP or hostname |
| `SERVER_SSH_KEY` | SSH private key (OpenSSH PEM) |
| `SERVER_USER` | SSH user (usually `root`) |
| `GHCR_USER` + `GHCR_TOKEN` | *(optional)* PAT with `read:packages` — only if the GHCR package stays private |

Optional GitHub **variable**: `DEPLOY_DIR` (default `/opt/vexevn`).

---

## 16. Troubleshooting

### Backend won't start

```bash
# Check logs:
docker service logs vexevn_backend --tail 100

# Common issues:
# 1. "JWT_SECRET not set" → generate one: openssl rand -hex 32
# 2. "unsupported DATABASE_URL" → the URL must start with sqlite:// (the
#    rust-sql engine is the only backend; postgres URLs are rejected)
# 3. "migration failed" → check logs for the specific migration error
```

### 415 Unsupported Media Type

This was a bug in `auth-fetch.ts` where headers were lost. **Fixed in commit `e4f6a74`**. If you still see it, pull the latest code.

### 429 Too Many Requests

The rate limiter (`tower_governor`) allows 600 RPM per IP with 100 burst. To increase:

```bash
# In .env:
RATE_LIMIT_RPM=6000
RATE_LIMIT_BURST=1000

# Restart:
docker service update --force vexevn_backend
```

### WebSocket not connecting

- Check Caddy is running: `docker service ls | grep caddy`
- Check Caddyfile has the correct domain
- Check backend is healthy: `curl -sf http://localhost:8080/health`
- WS endpoint: `wss://yourdomain.com/ws?token=<JWT>`

### NullClaw not replying

```bash
# Check status:
curl -sf http://localhost:8080/api/nullclaw/status
# Should return {"enabled":true,"provider":"http"}

# Check NullClaw container:
docker service logs vexevn_nullclaw --tail 50

# Common issues:
# 1. NULLCLAW_ENABLED=false → set to true
# 2. NULLCLAW_API_URL wrong → should be http://nullclaw:42617
# 3. GEMINI_API_KEY missing → get one from Google AI Studio
# 4. No human agent offline → AI only replies when 0 employees are online
```

### Database busy

The rust-sql engine serializes writes (SQLite-dialect semantics) and the
pool applies `PRAGMA busy_timeout=5000` + WAL mode at boot. Under extreme
write contention you may still see "database is busy" errors — scale the
app horizontally and shard write-heavy workloads, or rate-limit bursts.

---

## 17. Local Development

### Prerequisites

- Rust 1.97+ (`rustup install stable`)
- Bun 1.2+ (`curl -fsSL https://bun.sh/install | bash`)
- No database to install — the rust-sql (rustqlite) engine builds from the `rust-sql/` submodule with the app (`git submodule update --init --recursive`)

### Start the backend

```bash
# Terminal 1: backend
cd /home/z/my-project/server_worktree
cp .env.example .env  # Edit as needed
cargo run -- serve
# Backend on http://localhost:8080
```

### Start the frontend

```bash
# Terminal 2: frontend (Vite dev server with proxy)
cd /home/z/my-project/server_worktree/frontend
bun install
bun run dev
# Frontend on http://localhost:3000
# API requests proxied to http://localhost:8080
```

### Verify

```bash
# Health check:
curl -sf http://localhost:8080/health

# Swagger UI:
open http://localhost:8080/swagger-ui

# Frontend:
open http://localhost:3000
```

### CLI commands

```bash
# Generate JWT secret:
cargo run -- key generate

# Hash a password:
cargo run -- key hash "mypassword"

# Show resolved config:
cargo run -- config-show

# List all routes:
cargo run -- routes-list

# Show DB backend:
cargo run -- db-backend

# Import OSM data:
cargo run -- import-osm ./data/vietnam-latest.osm.pbf

# Run migrations manually:
./migrator up
./migrator list
```
