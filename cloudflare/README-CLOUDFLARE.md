# datxevui on Cloudflare — Next.js migration (branch `feat/cloudflare-migration`)

The Rust/axum backend + React SPA are being migrated to a single **Next.js 16 app running on Cloudflare Workers** via [`@opennextjs/cloudflare`](https://opennext.js.org/cloudflare).

**The frontend is the original DatXeVui SPA, ported verbatim** (`src/spa/` — the React 19 + TanStack Router + Tailwind 4 app from `frontend/`, adapted only for `@spa/*` import aliases and Next.js env access). It mounts client-side through the `src/app/[[...slug]]` catch-all; every route, component, layout and style matches the deployed production UI. The backend contract (121 OpenAPI paths) is implemented by the App Router API routes and the two WebSocket Durable Objects.

| Capability                                  | Before (Rust + VPS)               | After (this app)                                                                                                                                       |
| ------------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Frontend + API                              | axum + Vite React SPA (2 deploys) | **The original SPA verbatim** (`src/spa/`) + App Router API routes on Workers (1 deploy)                                                               |
| SQLite storage                              | rustqlite file on VPS             | **Cloudflare D1** (SQLite at the edge)                                                                                                                 |
| Full-text place search                      | Tantivy (in-process index)        | **Static shard index** built weekly by CI, served as Worker static assets (see below)                                                                  |
| Image storage (brand logos, route pictures) | S3/rustfs                         | **R2 bucket** (`/api/media/*` proxy + admin upload)                                                                                                    |
| Chat socket (`/ws`)                         | tokio WS hub                      | **ChatHub Durable Object** (`chat-hub.ts`) — same JSON frame protocol: join/leave/message/typing, presence fan-out, clientMsgId-idempotent persistence |
| Audio-call signalling (`/ws-call`)          | tokio WS hub + coturn             | **CallHub Durable Object** (`call-hub.ts`) — SDP/ICE relay, `to: "agent"` routing, presence + public STUN                                              |
| Cron jobs                                   | tokio scheduler in-process        | **Worker Cron Trigger** (every minute) running the job executor in-process — no container                                                              |
| Auth                                        | JWT + argon2 + refresh rotation   | JWT (jose, HS256) + PBKDF2 (WebCrypto) + refresh rotation — same cookie semantics                                                                      |

## Local development

```bash
bun install
bun run db:migrate:local      # apply D1 migrations (incl. seeds)
bun run places:fetch          # download the latest weekly place index into public/places/
CI=true bunx wrangler d1 execute DB --local --file migrations/seed.sql   # dev seed data
bun run dev                   # next dev + initOpenNextCloudflareForDev → real D1/R2 bindings locally

# Drive the cron executor manually:
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
5. `bun run places:fetch` (the build ships the place index as static assets; `bun run deploy` does not fetch it for you)

## Cron jobs (no container)

The Worker's Cron Trigger (`* * * * *`, see `wrangler.jsonc`) calls `scheduled()` in
`custom-worker.ts`, which feeds a synthetic `POST /api/jobs/tick` through the Next.js
handler in-process — same bindings, same request context as any API route, no public round
trip. The route stays callable with the `CRON_SERVICE_TOKEN` for manual runs.

Table-driven jobs are **claimed** with a compare-and-swap lease on `scheduled_job.next_run_at`
before they run, so overlapping ticks (a slow run, the admin "trigger" button) never run a
slot twice; a failed run is retried when its 10-minute lease expires. Frequent jobs
(`holds.sweep`) are idempotent under overlap instead.

| Rust job                                       | Cadence     | Cloudflare implementation                                                                                                                                                                      |
| ---------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `osm.import` (Tantivy place-index refresh)     | biweekly    | **Weekly CI**, not a runtime job — see "Place search"                                                                                                                                          |
| `coupons.expire` (campaign program expiration) | daily 00:10 | **`coupons.expire`** daily 00:10 — expires stale held coupons AND clears `active_holder`; ALSO enforced lazily at claim + wallet reads (a late/skipped run never lets a stale coupon through). |
| (in-process timers) `expire_stale_holds`       | 60s         | **`holds.sweep`** every tick — cancels expired pending bookings (in chunks of 20, D1 caps statements at 100 bound parameters), frees seats, returns their coupons.                             |
| (in-process timers) trip materializer          | 6h          | **`trips.warm`** every 6h — materializes trip_session + seat inventory for the 14-day sell window.                                                                                             |
| —                                              | daily       | **`trips.prune`** 02:30 + **`jobs.retention`** 04:00 (maintenance).                                                                                                                            |

Every run is recorded in `job_run` (30-day retention) and visible on the admin
cron-jobs page; `PATCH /api/admin/cron-jobs/{jobType}` reschedules table-driven
rows live.

## Place search (static shard index)

Place search has no database, container or native binary at runtime.

```text
Geofabrik Vietnam .osm.pbf ──► tools/place-extract (Rust) ──► places.ndjson
        ──► scripts/build-place-shards.ts ──► public/places/** ──► static assets
```

- **Extractor** (`tools/place-extract`): a standalone crate that reuses the backend's
  `osm_reader` / `spatial` / `vn_text` by path. `--profile` picks the coverage (each
  includes the previous one); measured on the real 330 MB extract (~25–35 s, ~260 MB RAM):

  | Profile                 | Adds                                                                                                | Unique places | Index (gzipped) | Files | Largest shard |
  | ----------------------- | --------------------------------------------------------------------------------------------------- | ------------- | --------------- | ----- | ------------- |
  | `travel`                | settlements, admin areas, intercity stations, airports, ferry terminals, attractions                | 22.8k         | 2.2 MB          | 2.7k  | 120 KB        |
  | `landmarks`             | hospitals, universities, markets, malls, pagodas/churches, parks, stadiums, historic sites, beaches | 38.8k         | 4.6 MB          | 3.7k  | 240 KB        |
  | **`full`** (CI default) | named streets, hotels / guesthouses                                                                 | 118k          | 11.9 MB         | 8.9k  | ~1 MB         |

  Static assets are free, and the Worker limit is 20,000 files (Free) / 100,000 (Paid), so
  `full` fits; pick a smaller profile from the workflow dispatch input if you want a
  lighter deploy. Alternative names (`alt_name`, `short_name`, `old_name`) are indexed too,
  so "Sài Gòn" finds Hồ Chí Minh City. Not indexed: buildings (e.g. Landmark 81) and
  places OSM does not map.

- **Builder** (`src/lib/places/build.ts`): emits the SPA's existing `type` vocabulary
  (`bus_station`, `rail_station`, `road_primary`, `amenity_hospital`…) so every result already
  has a Vietnamese/English label (`src/spa/lib/place-type.ts`); never uses type words such as
  "Đường", "Phường", "Xã" as shard keys (they would put every street in one file); drops places outside the 63 served provinces
  (the Geofabrik clip includes Laos/Cambodia/China border areas), canonicalises province
  names to `src/lib/cities.ts`, merges the node + relation twins of one city, and writes
  prefix-sharded search files (`s/<key>.json`, 3-char prefix, split to 4 when > 1,200
  records) plus 0.25° geo cells of areas only for reverse geocoding (`g/<cell>.json`).
- **Search** (`src/lib/places/search.ts`): reads only the shards a query needs through the
  `ASSETS` binding — the smallest ones first, so "nguyen hue" never loads the surname's
  megabyte shard — with a bounded per-isolate cache and memoised tokenisation. Tone/case/spacing-insensitive, prefix matching, `hanoi` = `ha noi`,
  type words (`ga`, `bến xe`, `phường`) are optional but ranked, address context counts.
- **CI** (`.github/workflows/place-index.yml`): weekly (Mondays 03:17 Vietnam time) it builds
  the index, attaches `place-index.tgz` to the rolling `place-index` release, and redeploys.
  Ordinary deploys run `bun run places:fetch` to pick up the same tarball. Pull requests that
  touch the pipeline build against the real extract but never publish.

OSM does not map every station (e.g. Bến xe Mỹ Đình is absent from the extract); brand
pickup points remain the source of truth for bookable stops.

## Abuse protection (rate limiting + lockout)

Three layers, because each tool is good at one thing:

| Layer                             | Guards                          | Exactness                                         | Where                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------- | ------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account lockout**               | password guessing               | exact, durable (D1)                               | `src/lib/auth/lockout.ts` — 5 wrong passwords lock the account for 15 min (`user.failed_login_attempts` / `locked_until`, one atomic `UPDATE`); success or a password change clears it. A locked account answers `429 account-locked` + `Retry-After`.                                                                                                                                                         |
| **Workers Rate Limiting binding** | per-account / per-user bursts   | best-effort (per location, eventually consistent) | `src/lib/rate-limit.ts` — `AUTH_LIMITER` (10/min, keyed by the account being tried, checked _before_ any DB or hashing work) and `WRITE_LIMITER` (30/min, keyed by user id: booking, coupon claim, payment, chat, review, post, price alert, upload). `429 rate-limited` + `Retry-After: 60` (the full window — the binding does not report what is left). Off when the binding is absent (tests, `next dev`). |
| **Edge rate-limiting rule (WAF)** | per-IP floods, anonymous writes | per IP                                            | configured in the dashboard, not in code — see below                                                                                                                                                                                                                                                                                                                                                           |

**Edge rule.** Cloudflare's Free plan allows exactly **one** rate-limiting rule (counted per
IP, 10 s window, 10 s block); Pro allows two. Spend the one rule on the endpoints that are
anonymous and either expensive or write to D1:

```text
(http.request.uri.path in {"/api/auth/login" "/api/auth/register" "/api/auth/employee-login"
  "/api/auth/refresh" "/api/vitals" "/api/ads/conversions"})
```

Suggested: 20 requests / 10 s per IP, block 10 s. Rules apply to traffic on your zone (a custom
domain), not to the `*.workers.dev` hostname — put the production Worker on a custom domain.

Known trade-off: anyone who knows an email can lock that account for 15 minutes with five bad
guesses. That is the price of an exact bound on online guessing; OAuth and refresh-token
sessions are unaffected.

## API surface

All 121 OpenAPI contract paths from the Rust backend are implemented:

- **Customer**: auth (login/register/refresh/me/logout/password/employee-login),
  OAuth provider discovery (+ start/callback 501-stubs until credentials are set),
  place search/list/reverse (static shards), trip search + geo search, recommendations,
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
- End-to-end against local D1: register/login/refresh/logout, shard-index place search,
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
- **Recursive CTEs, conditional atomic `UPDATE`s, analytics**
  → `sql` tagged templates (`rawAll`/`rawRun`). Values interpolate as bound
  parameters, so both styles are injection-safe; the builder is simply the
  more ergonomic default.
- **Atomic multi-statement units** → `atomicBatch([...])` (`src/lib/db/client.ts`):
  one native D1 batch = one implicit transaction, accepting typed builders AND
  raw `sql` templates side by side (booking creation mixes both).
- `sqlIn(values)` builds parameterized `IN (...)` lists.
- Sweep status: services (`lookups`, `jobs`, `chat`, `booking`, `claim`,
  `coupons/mine`, `cron-jobs`, `reviews/[id]`, `admin/stats`) are builder-first;
  the remaining `sql` templates in them are the documented exceptions above
  (json_each, scalar-subquery counters, conditional UPDATE guards,
  dynamic unread column).

## Coupon lifecycle (Rust parity, enforced end to end)

```
claim ──► held (active_holder = user, UNIQUE)
        └─ booking created ──► reserved (booking_id set, holder kept)
                                 ├─ payment confirmed / admin confirm / IPN
                                 │    └─► redeemed (holder released, owed payout)
                                 └─ cancel / hold-expiry sweep
                                      └─► held again (window still open)
                                          or expired (window passed)
give-up ─► released (+ tier slot back while the campaign runs)
nightly coupons.expire + lazy expiry at claim/wallet ─► expired + holder cleared
```

- Migration `0004` adds the Rust unique indexes (`code`, `active_holder`,
  `(campaign_id, user_id)`, `booking_id`) — the race-safe backstop for
  "one active coupon per account" and "one claim per campaign". It
  self-heals rows written by the pre-parity code before creating them.
- The SPA already speaks this lifecycle (`reserved`, `released` statuses have
  i18n labels; the wallet's "on booking" chip keys off `status === 'reserved'`).

## Realtime: chat + calls (corporate-network ready)

- **Chat (`/ws` → `ChatHub` DO)**: the SPA's exact JSON frame protocol,
  messages persisted to D1 idempotently (clientMsgId), staff auto-claim,
  presence fan-out; REST lifecycle bridge via `POST /emit`.
- **Calls (`/ws-call` → `CallHub` DO)**: WebRTC signalling (offer/answer/ice/
  renegotiate/hangup relay, `to: "agent"` routing, in-call tracking so a
  socket blip mid-call doesn't kill live audio).
- **TURN — the corporate-firewall lifeline**: direct P2P audio fails behind
  symmetric NATs / UDP-blocking firewalls. The CallHub mints short-lived
  **Cloudflare Calls TURN** credentials server-side
  (`turn.cloudflare.com` — UDP 3478/443, TCP 3478/80, and **TLS over 443**
  which passes HTTPS-only corporate proxies) and pushes them in the
  `registered` frame + `ice-servers` rotation frames (the SPA client already
  handles both). Anycast picks the nearest Cloudflare location per client.
  Setup: create a TURN key in the dashboard (Realtime → TURN) and set the
  `TURN_KEY_ID` + `TURN_KEY_API_TOKEN` secrets (`TURN_TTL_SECONDS` optional,
  default 86400). Without them the hub falls back to public STUN — calls
  still work on NAT-friendly networks. Cost: $0.05/GB relayed egress
  (≈22 MB per audio-call hour; the relay engages only when direct fails).
- **Hibernation-safe hubs**: session state rides on each WebSocket's
  attachment (`serializeAttachment`), the live set always comes from
  `ctx.getWebSockets()`, and call heartbeats are answered by the platform
  (`setWebSocketAutoResponse`) without waking the DO — a hibernated +
  evicted DO rehydrates instead of dropping every live socket, and
  thousands of idle sockets cost ~nothing.
- **Scale ceiling**: both hubs are single global DOs (Rust was a single
  process too). With hibernation this comfortably serves tens of thousands
  of concurrent sockets; the sharding path (per-channel DO ids + DO-to-DO
  presence fan-out) is documented as a future step if staff presence ever
  needs to stay global across shards.

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
(rollback verified), parameterized `sqlIn`, the full refresh-token session
lifecycle over the real migration chain, the seat-plan engine (validate /
trusted / derive / sync in-use guard / template fit), Cloudflare TURN
credential minting+cache+fallback, and the end-to-end coupon lifecycle
(claim → reserve → redeem/return → give-up → nightly expiry → unique-index
race guards) over migrations 0000–0004.
