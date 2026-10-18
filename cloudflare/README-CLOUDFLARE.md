# datxevui on Cloudflare — Next.js migration (branch `feat/cloudflare-migration`)

The Rust/axum backend + React SPA are being migrated to a single **Next.js 16 app running on Cloudflare Workers** via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

**The frontend is the original DatXeVui SPA, ported verbatim** (`src/spa/` — the React 19 + TanStack Router + Tailwind 4 app from `frontend/`, adapted only for `@spa/*` import aliases and Next.js env access). It mounts client-side through the `src/app/[[...slug]]` catch-all; every route, component, layout and style matches the deployed production UI. The backend contract (121 OpenAPI paths) is implemented by the App Router API routes and the two WebSocket Durable Objects.

| Capability | Before (Rust + VPS) | After (this app) |
|---|---|---|
| Frontend + API | axum + Vite React SPA (2 deploys) | **The original SPA verbatim** (`src/spa/`) + App Router API routes on Workers (1 deploy) |
| SQLite storage | rustqlite file on VPS | **Cloudflare D1** (SQLite at the edge) |
| Full-text place search | Tantivy (in-process index) | **D1 FTS5** virtual table + triggers |
| Image storage (brand logos, route pictures) | S3/rustfs | **R2 bucket** (`/api/media/*` proxy + admin upload) |
| Chat socket (`/ws`) | tokio WS hub | **ChatHub Durable Object** (`chat-hub.ts`) — same JSON frame protocol: join/leave/message/typing, presence fan-out, clientMsgId-idempotent persistence |
| Audio-call signalling (`/ws-call`) | tokio WS hub + coturn | **CallHub Durable Object** (`call-hub.ts`) — SDP/ICE relay, `to: "agent"` routing, presence + public STUN |
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

> **Note:** `next dev` does not route through `custom-worker.ts`, so the two WS hubs
> (`/ws`, `/ws-call`) only exist under `bun run preview` / production. In dev the SPA
> falls back to the REST paths (chat sends + polling), same as a dropped connection.

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
3. Set secrets: `wrangler secret put JWT_SECRET`, `wrangler secret put CRON_SERVICE_TOKEN` (+ payment secrets as needed)
4. `bun run db:migrate:remote`
5. Configure the container env vars (`APP_URL`, `CRON_SERVICE_TOKEN`) — see `container/.env.example`

## The cron container

`container/` builds a Node 22 image that owns the schedules (per the migration plan):
a per-minute tick POSTs `/api/jobs/tick` on the Worker with the shared service token.
The Worker's `scheduled` handler (Cron Trigger `* * * * *`) pings the container's
`/health` as a heartbeat so it never sleeps. `custom-worker.ts` wires the
`CronContainer` Durable Object that wraps the image.

## API surface

All 121 OpenAPI contract paths from the Rust backend are implemented:

- **Customer**: auth (login/register/refresh/me/logout/password/employee-login),
  OAuth provider discovery (+ start/callback 501-stubs until credentials are set),
  place search/list/reverse (FTS5), trip search + geo search, recommendations,
  trip detail + seat map, booking hold/place/cancel, payments (COD, VietQR, VNPay
  URL, MoMo/ZaloPay env-gated) + IPN webhooks, coupons wallet + give-up,
  campaign listing + tier claim, loyalty, notifications, price alerts, reviews
  (list/stats/tags/mine + CRUD), posts, vitals, ads conversions, stats.
- **Staff/admin**: brands, routes, schedules (with class fares + points),
  vehicle types, bus layouts (+ presets/plan/fit — the Rust seat-plan preset
  catalog ported to `admin-out.ts`), addresses, pickup points, bookings
  (list/stats/export/detail/status), payments (list/summary/force-status),
  reviews moderation, campaigns CRUD, coupons audit + payouts/settle/reject,
  chat stats, cron jobs (registry/runs/reschedule/cancel/trigger), system
  status/metrics/database/memory (Workers-flavoured equivalents), users + roles.
- **Infra**: `/health`, `/ready`, `/sitemap.xml`, `/robots.txt` (static).

RBAC mirrors the Rust seed exactly (roles, permission catalogue, admin-only set),
with a healing fallback that derives permissions from `users.role` when the
`user_roles` grants are missing.

## Verification done in this phase

- `next build` + `opennextjs-cloudflare build` green; `tsc --noEmit` clean
- **UI walkthrough (browser) through the original SPA**: home (hero, stats, search
  form, brands), search results (filters, facets, trip cards), trip detail with the
  two-deck sleeper seat map (VIP fares, occupied/available states), account console
  (loyalty tier, bookings), admin dashboard + every admin page: tickets (list/stats/
  CSV export), brands, bus-layouts, vehicle-types, payments, feedback moderation,
  campaigns, cron-jobs (registry + run history), system monitor, users, chat workspace
- **WebSocket hub smoke tests** (`cloudflare/scripts/*-test.mjs`): cookie-auth →
  `hello`, `ping`→`pong`, staff/customer room join, message broadcast both sides,
  typing relay, clientMsgId idempotency (WS insert + REST replay = 1 row),
  `/ws-call` register → offer relay (`incoming`) → hangup
- **Contract sweep**: 63/63 OpenAPI GET/POST endpoints return JSON (no SPA-HTML
  fallback), authed as admin
- End-to-end against local D1: register/login/refresh/logout, FTS5 place search,
  trip search with facets, all-or-nothing seat claim (409 on conflict),
  child-discount fare logic, COD payment → mark-collected → booking confirmed,
  hold-expiry sweep, trips.warm (98 sessions), R2 media upload/serve with ETag/304

## Pending / next phases

- OAuth start/callback implementations (Google/Facebook/Apple) once credentials exist
- NullClaw AI assistant (status + exchange audit endpoints are stubbed)
- Web push notifications (device registration endpoints optional)
- Valhalla routing proxy (`/api/routing/*`) — map features currently degrade gracefully
- Load-test + D1 read-replica evaluation at scale

## Database schema & migrations (drizzle-kit → wrangler D1)

The TypeScript schema in `src/lib/db/schema/` is the **single source of truth**.
The workflow (Cloudflare's documented D1 + Drizzle flow):

1. Edit the schema files.
2. `bun run db:generate` — `drizzle-kit generate` diffs the schema against the
   last snapshot in `migrations/meta/` and emits `migrations/NNNN_*.sql`
   (every interpolated value is a bound parameter — no string concatenation).
3. `bun run db:migrate:local` (or `:remote`) — **wrangler** applies the new
   files to D1. Never let drizzle-kit itself apply D1 migrations; wrangler
   owns application and tracks applied files in `d1_migrations`.

Migrations `0000`–`0002` were hand-written and already applied everywhere;
`0003_drizzle_baseline` is a no-op that marks where the drizzle-kit snapshot
chain was baselined to exactly that applied schema (verified: `drizzle-kit
generate` no-ops on a clean schema and emits correct `ALTER`s on change —
see `scripts/check-drizzle-drift.py` for the schema-vs-migrations diff tool).

## SQL style policy

- **Standard CRUD** → the drizzle query builder (`db.select/insert/update/
  delete` over typed tables): typed results, free parameterization.
- **FTS5 `MATCH`, recursive CTEs, conditional atomic `UPDATE`s, analytics**
  → `sql` tagged templates (`rawAll`/`rawRun`). Values interpolate as bound
  parameters, so both styles are injection-safe; the builder is simply the
  more ergonomic default.
- **Atomic multi-statement units** → `atomicBatch([...])` (`src/lib/db/client.ts`):
  one native D1 batch = one implicit transaction, accepting typed builders AND
  raw `sql` templates side by side (booking creation mixes both).
- `sqlIn(values)` builds parameterized `IN (...)` lists.

## Cache & retry for store lookups

- **`cacheFirst(key, loader, { ttlMs, kvTtlSecs })`** (`src/lib/db/cache.ts`) —
  the port of the Rust app's moka cache-first reads. L1: per-isolate `Map`
  (bounded, TTL, LRU-ish). L2: Workers KV via the optional `CACHE_KV`
  binding — survives isolate eviction, shared across isolates/colos
  (eventually consistent, ≤60s; best-effort, never throws). No binding →
  memory-only, automatically.
  Cached today: brands, brand detail, default routes page, vehicle-type
  catalog, popular places, campaigns, review tags, homepage stats
  (`src/lib/services/lookups.ts`). NEVER cached: seats, availability,
  bookings, payments, auth — correctness-critical reads go straight to D1.
  Admin write routes call the matching `invalidate*` helper so changes
  surface immediately.
- **`withRetry(fn)`** (`src/lib/db/retry.ts`) — `p-retry` with exponential
  backoff + full jitter, retrying only transient D1 failures
  (D1_ERROR: internal, SQLITE_BUSY/LOCKED, dropped connections, 5xx);
  deterministic failures (UNIQUE/FK/CHECK, 4xx ApiError) abort with the
  original error identity preserved. Applied to reads and idempotent
  writes only — side-effecting writes (bookings, payments) are never
  retried, since a timed-out request may already have committed.

## Session cookies & the embedded preview

`COOKIE_SAMESITE` (default `lax`) controls the cookie policy:
- **`lax`** (production, first-party datxevui.com): `SameSite=Lax` +
  `Secure` when the request is HTTPS (`x-forwarded-proto` aware) — the Rust
  backend's default.
- **`none`** (set in `.dev.vars` for the sandbox preview): `SameSite=None;
  Secure; Partitioned` — the CHIPS combination. The preview is served on a
  proxied HTTPS origin inside a cross-site iframe, where browsers drop Lax
  cookies (the "logs in, bounces back to /login" loop). Partitioned cookies
  survive third-party cookie blocking while staying double-keyed to the
  embedding site.

## Tests

`bun run test` — vitest inside **workerd** via `@cloudflare/vitest-plugin`,
with real D1 + KV bindings (Miniflare): cookie policy matrix, retry
classification/behavior, two-tier cache semantics, `atomicBatch` atomicity
(rollback verified), parameterized `sqlIn`, and the full refresh-token
session lifecycle over the real migration chain.
