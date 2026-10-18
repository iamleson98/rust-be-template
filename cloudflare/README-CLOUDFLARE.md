# datxevui on Cloudflare — Next.js migration (branch `feat/cloudflare-migration`)

The Rust/axum backend + React SPA are being migrated to a single **Next.js 16 app running on Cloudflare Workers** via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

| Capability | Before (Rust + VPS) | After (this app) |
|---|---|---|
| Frontend + API | axum + Vite React SPA (2 deploys) | Next.js 16 App Router on Workers (1 deploy) |
| SQLite storage | rustqlite file on VPS | **Cloudflare D1** (SQLite at the edge) |
| Full-text place search | Tantivy (in-process index) | **D1 FTS5** virtual table + triggers |
| Image storage (brand logos, route pictures) | S3/rustfs | **R2 bucket** (`/api/media/*` proxy + admin upload) |
| Chat / presence / audio calls | Custom WebSocket hubs + coturn TURN | **Cloudflare Realtime** (RealtimeKit meetings per channel) + D1 history |
| Cron jobs | tokio scheduler in-process | **Cloudflare Container** (node timers) + Worker Cron-Trigger heartbeat |
| Auth | JWT + argon2 + refresh rotation | JWT (jose, HS256) + PBKDF2 (WebCrypto) + refresh rotation — same cookie semantics |

## Local development

```bash
bun install
bun run db:migrate:local      # apply D1 migrations (incl. FTS5 + seeds)
CI=true bunx wrangler d1 execute DB --local --file migrations/seed.sql   # dev seed data
bun run dev                   # next dev + initOpenNextCloudflareForDev → real D1/R2 bindings locally

# Drive the cron executor manually (or run the container):
curl -X POST localhost:3000/api/jobs/tick -H "X-Cron-Token: dev-cron-service-token"
```

Secrets live in `.dev.vars` (git-ignored).

## Production build & deploy

```bash
bunx next build                     # standard Next.js build
bunx opennextjs-cloudflare build    # → .open-next/worker.js (Workers bundle)
bun run preview                     # wrangler dev against the real built worker
bun run deploy                      # wrangler deploy
```

Before the first deploy:
1. `bunx wrangler d1 create datxevui` → put the returned `database_id` into `wrangler.jsonc`
2. `bunx wrangler r2 bucket create datxevui-uploads`
3. Set secrets: `wrangler secret put JWT_SECRET`, `wrangler secret put CRON_SERVICE_TOKEN` (+ payment/Realtime secrets as needed)
4. `bun run db:migrate:remote`
5. Configure the container env vars (`APP_URL`, `CRON_SERVICE_TOKEN`) — see `container/.env.example`

## The cron container

`container/` builds a Node 22 image that owns the schedules (per the migration plan):
a per-minute tick POSTs `/api/jobs/tick` on the Worker with the shared service token.
The Worker's `scheduled` handler (Cron Trigger `* * * * *`) pings the container's
`/health` as a heartbeat so it never sleeps. `custom-worker.ts` wires the
`CronContainer` Durable Object that wraps the image.

## Verification done in this phase

- `next build` + `opennextjs-cloudflare build` both green (34 routes)
- End-to-end against local D1: register/login/refresh/logout, FTS5 place search,
  trip search with facets, seat map, all-or-nothing seat claim (409 on conflict),
  child-discount fare logic, COD payment → mark-collected → booking confirmed,
  hold-expiry sweep, trips.warm (98 sessions), chat REST with clientMsgId
  idempotency, R2 media upload/serve with ETag/304, admin stats/brands/jobs.
- Browser-verified flows: home, login, search, seat selection, booking dialog,
  checkout (COD), bookings list/detail, support chat, admin dashboard.

## Migration status (what's ported vs pending)

**Ported & working** — auth (register/login/refresh/logout/me, RBAC seeds,
first-user-admin), public catalog (brands, routes, trip detail + seat map +
fares), city-pair search (filters/sorting/facets), FTS5 place search
(+ abbreviations, tone-insensitive, kind boosts), recommendations, stats,
reviews (list/create/mine), bookings (hold/cancel/place + sweeper), payments
(COD complete, VietQR EMV QR generation, VNPay URL+HMAC signing; MoMo/ZaloPay
behind config flags like the Rust env-gated providers), R2 media + logo upload,
chat REST (channels/messages/read/claim/release/close), Realtime token minting
(RealtimeKit Add Participant), jobs executor + container driver, admin
(stats/brands CRUD/cron-jobs), auto-refresh-on-401 in the client.

**Not yet ported (tracked for the next phases)** — OAuth (Google/Facebook),
webhooks (Zalo/Messenger/Telegram/Discord) + NullClaw AI, VNPay/MoMo/ZaloPay
IPN callbacks, push notifications (FCM/APNs), loyalty/coupons campaign claim
UI (service layer exists), price alerts, ads conversions, routing proxy
(Valhalla), anti-scraping middleware (Cloudflare WAF rules replace it at the
edge), openapi.json spec export, Vietnamese i18n toggling (UI is vi-only),
mobile app rewire to the new endpoints.
