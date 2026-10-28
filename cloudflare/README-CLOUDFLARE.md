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

# Drive the cron executor manually (token = CRON_SERVICE_TOKEN from .dev.vars):
curl -X POST localhost:3000/api/jobs/tick -H "X-Cron-Token: $CRON_SERVICE_TOKEN"
```

Secrets live in `.dev.vars` (git-ignored).

> **Note:** `next dev` does not route through `custom-worker.ts`, so the two WS hubs
> (`/ws`, `/ws-call`) only exist under `bun run preview` / production. In dev the SPA
> falls back to the REST paths (chat sends + polling), same as a dropped connection.

## Production build & deploy

**Merging to the default branch deploys.** `feat/cloudflare-migration` is the repository's
default branch; every PR targets it, and a push to it runs `.github/workflows/cloudflare-deploy.yml`:

```text
typecheck + tests → install the latest place index → apply pending D1 migrations
  → opennextjs-cloudflare build + deploy → GET $SITE_URL/health
```

- Deploys never overlap (runs queue), and a failing test or typecheck stops before anything
  ships. Feature-branch pushes only run the checks in `cloudflare.yml`; they never deploy.
- **Migrations run before the new code goes live**, so write them to keep the previous version
  working (add columns/tables now, remove things in a later release).
- The weekly `place-index.yml` build rebuilds the OSM shards, publishes the `place-index`
  release and calls the same deploy workflow.
- Repo settings it relies on: secrets `CLOUDFLARE_API_TOKEN` (Workers write + **D1 edit**) and
  `CLOUDFLARE_ACCOUNT_ID`; variable `SITE_URL` (the public origin, for the health check).
- Rollback: Cloudflare keeps previous versions (`bunx wrangler rollback`); D1 migrations are
  forward-only, which is why they must stay backward compatible.

Manual deploy from a laptop (needs `wrangler login` or `CLOUDFLARE_API_TOKEN`):

```bash
bun install --frozen-lockfile
bun run places:fetch                      # latest place index into public/places/
bunx wrangler d1 migrations apply DB --remote
bun run deploy                            # opennextjs-cloudflare build + deploy
```

One-time setup (already done for the production account): `wrangler d1 create datxevui
--location apac`, `wrangler kv namespace create CACHE_KV`, `wrangler r2 bucket create
datxevui-uploads` (ids go in `wrangler.jsonc`), `wrangler secret put JWT_SECRET`,
`CRON_SERVICE_TOKEN`, and the TURN key (`TURN_KEY_ID`, `TURN_KEY_API_TOKEN`). **Register the
first account yourself right after the first deploy: the first registrant becomes admin.**

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

  | Profile                | Adds                                                                                                                                                                            | Unique places | Index (gzipped) | Files | Largest shard     |
  | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | --------------- | ----- | ----------------- |
  | `travel`               | settlements, admin areas, intercity stations, airports, ferry terminals, attractions                                                                                            | 22.8k         | 2.2 MB          | 2.7k  | 120 KB            |
  | `landmarks`            | hospitals, universities, markets, malls, pagodas/churches, parks, stadiums, historic sites, beaches                                                                             | 38.8k         | 4.6 MB          | 3.7k  | 240 KB            |
  | `full`                 | named streets, hotels / guesthouses                                                                                                                                             | 118k          | 11.9 MB         | 8.9k  | ~1 MB             |
  | **`all`** (CI default) | every named shop, restaurant, bank, school, fuel station, building, waterway, land-use area and bus stop, plus house-number addresses ("12 Lê Lợi") and numbered roads ("QL1A") | 304k          | 29.9 MB         | 16.4k | 2.6 MB ("Nguyễn") |

  `all` is the same coverage class as the old Rust index (every named feature and address;
  it drops unnamed benches and post boxes, railway lines and slip roads). Static assets are
  free; the Worker limit is 20,000 files (Free) / 100,000 (Paid) and the app itself uses ~3,000,
  so `all` fits the Free plan only barely — use Paid, or pick a smaller profile from the
  workflow dispatch input. `build-place-shards` warns past the Free limit and fails past Paid.
  Alternative names (`alt_name`, `short_name`, `old_name`) are indexed too, so "Sài Gòn" finds
  Hồ Chí Minh City. Not indexed: whatever OSM does not map (Landmark 81 and Bến xe Mỹ Đình are
  absent from the extract) and unnamed benches, post boxes and the like.

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

| Layer                                       | Guards                                        | Exactness                                         | Where                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account lockout**                         | password guessing                             | exact, durable (D1)                               | `src/lib/auth/lockout.ts` — 5 wrong passwords lock the account for 15 min (`user.failed_login_attempts` / `locked_until`, one atomic `UPDATE`); success or a password change clears it. A locked account answers `429 account-locked` + `Retry-After`.                                                                                                                                                         |
| **Workers Rate Limiting binding**           | per-account / per-user bursts                 | best-effort (per location, eventually consistent) | `src/lib/rate-limit.ts` — `AUTH_LIMITER` (10/min, keyed by the account being tried, checked _before_ any DB or hashing work) and `WRITE_LIMITER` (30/min, keyed by user id: booking, coupon claim, payment, chat, review, post, price alert, upload). `429 rate-limited` + `Retry-After: 60` (the full window — the binding does not report what is left). Off when the binding is absent (tests, `next dev`). |
| **Per-IP limiter (Worker, before Next.js)** | per-IP floods on `/api/*` and socket upgrades | best-effort (per location)                        | `src/lib/edge-guard.ts` via `custom-worker.ts` — see below                                                                                                                                                                                                                                                                                                                                                     |
| **Edge rate-limiting rule (WAF)**           | per-IP floods, before the Worker runs         | per IP                                            | configured in the dashboard, not in code — see below                                                                                                                                                                                                                                                                                                                                                           |

**Per-IP limiter (in code).** `custom-worker.ts` runs `enforceIpLimit` before anything else,
keyed on `CF-Connecting-IP` with IPv6 collapsed to its /64 (IPv4-mapped IPv6 becomes the
IPv4 address). Two bindings, 60 s window: `IP_READ_LIMITER` (600/min, the Rust limit) for
`/api/*`, and `IP_STRICT_LIMITER` (100/min) for `/api/auth/*`, `/api/uploads/*`,
`/api/search*`, `/api/recommendations`, `/api/vitals`, `/api/ads/*` and `/ws` + `/ws-call`
upgrades (socket upgrades use their own `ws:` key). Exempt: `/health`, `/ready`,
`/api/health`, `/sitemap.xml`, `/robots.txt`, `/api/payments/ipn/*`. A limited request gets
`429` + `Retry-After: 60`. With no binding or no client IP (tests, `next dev`) it fails open.
Tune `limit` in `wrangler.jsonc`; the strict bucket is shared by everyone behind one
carrier-grade NAT address, so raise it rather than lower it if real users report 429s.

**Origin check.** POST/PUT/PATCH/DELETE under `/api/` need an `Origin` (or `Referer`) on this
host or in `WS_ALLOWED_ORIGINS`, else `403 forbidden` (Rust `anti_scraping.rs`). Exempt: IPN
webhooks, `/api/vitals`, `/api/jobs/tick` (token-authenticated) and `X-Client: mobile`.

**Security headers and caching.** Dynamic responses get HSTS (`max-age=15552000;
includeSubDomains`), `nosniff`, `X-Frame-Options: DENY` and `Referrer-Policy:
strict-origin-when-cross-origin` (never overriding a header a route set); `public/_headers`
adds the same to static files plus a day of cache (+ a week stale-while-revalidate) for
fonts, icons and images (`sw.js` stays `no-cache`). `GET /api/brands`, `/api/stats`,
`/api/routes` and `/api/reviews/tags` are served from the Workers Cache API
(`s-maxage=30, stale-while-revalidate=120`): a hit costs no D1 read and no KV operation. The
cache is per data centre and only works on a custom domain, not `*.workers.dev`.

### Dashboard steps still to do (cannot be done in code)

1. **Free WAF rate-limit rule for `/api/*`** (stops floods before the Worker is invoked, so it
   saves requests): Cloudflare dashboard → select `datxevui.com` → **Security → WAF → Rate
   limiting rules → Create rule**. Name: `api-per-ip`. Expression (edit expression):
   `starts_with(http.request.uri.path, "/api/")`. Characteristic: **IP**. Requests: **100**,
   period: **10 seconds** (the free plan only offers 10 s), action **Block**, duration **10
   seconds**. **Deploy**. The free plan allows one rule, so this replaces the narrower
   login-only rule suggested below.
2. **Bot Fight Mode**: **Security → Bots → Bot Fight Mode → On**.
3. **www → apex 301**: **Rules → Redirect Rules → Create rule**, name `www-to-apex`. Custom
   filter: Hostname **equals** `www.datxevui.com`. Then: **Dynamic** URL redirect, expression
   `concat("https://datxevui.com", http.request.uri.path)`, status **301**, **Preserve query
   string** on. **Deploy**. (The `www` Worker custom domain in `wrangler.jsonc` must stay so the
   hostname still reaches Cloudflare and the rule can answer it.)

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
- **Infra**: `/health`, `/ready`, `/sitemap.xml`, `/robots.txt` (generated, the Rust text).

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
- Valhalla server for `/api/routing/*` — the proxy is ported; set `VALHALLA_URL` to switch it on (until then it answers "not configured" and the map degrades gracefully)
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
- Claim eligibility, atomicity, error codes and the public list follow Rust
  `campaign_service.rs`: only active non-guest non-bot `user` accounts claim;
  the claim is one D1 `batch()` (`campaign-claim.ts`); every coupon error's
  `message` is the stable code the SPA translates (`campaign-codes.ts`);
  a coupon is checked against the booking's operator both when pricing and
  when reserved.
- The SPA already speaks this lifecycle (`reserved`, `released` statuses have
  i18n labels; the wallet's "on booking" chip keys off `status === 'reserved'`).

## Realtime: chat + calls

```text
web customer ──┐                       ┌── ChatHub  (/ws)       one DO, hibernating sockets
web agent    ──┼── wss (443) ── Worker ┤
mobile agent ──┘                       └── CallHub  (/ws-call)  signalling + call sessions
                                          media: peer to peer, relayed by Cloudflare TURN
```

**Why not RealtimeKit / the SFU?** Peer-to-peer WebRTC with a TURN fallback is the cheapest
design that keeps working with the existing web and mobile clients: a 1:1 audio call costs
nothing unless the media has to be relayed (TURN: ~22 MB per call-hour, free for the first
1,000 GB/month, then $0.05/GB), versus RealtimeKit audio at $0.0005 per participant-minute
(≈ $0.06 per 1:1 call-hour) plus a client rewrite. Switch only if you need group calls.

### Call hub (`call-hub.ts`, `src/lib/calls/sessions.ts`)

A port of the Rust `audio_call` module. The state machine is pure and unit-tested
(`tests/unit/call-sessions.test.ts`); the Durable Object wires sockets to it.

- **Identity and roles are the server's**: who a socket is comes from the verified JWT (a
  client-supplied `userId` is ignored) and only staff may register as `agent`.
- **A customer's call rings one free agent** — the one rung longest ago — regardless of what
  chat channel the agent has open (an on-duty phone has none), and **escalates** to the next
  agent on decline, busy or a 60 s ring timeout. A multi-device agent rings everywhere; the
  device that answers wins and the rest get `answered-elsewhere`.
- **Network switches don't kill calls**: an answered call outlives a dropped socket for 15 s;
  `register {resume: true}` takes it over, and `registered.activeCall` tells the client the
  truth. ICE-restart offers/answers are relayed as `renegotiate` (never a second ring).
- **Survives hibernation and eviction**: sessions live in Durable Object storage and the ring /
  grace / maximum-length timers are one storage alarm.
- **Customers: Vietnam only** (`CALL_ALLOWED_COUNTRIES`, default `VN`; staff exempt) using the
  edge-verified country; refused callers get `region-blocked` and close code 4403.
- Heartbeats: the web client's exact frame is answered by the platform without waking the DO;
  the mobile app's (`__client_ts` appended) by the hub — both with `pong`, which the app's
  half-open-socket watchdog needs.
- Cookie-authenticated upgrades are Origin-checked (`WS_ALLOWED_ORIGINS` for extra origins);
  token-authenticated clients (mobile) skip it.

### Corporate and restrictive networks

ICE servers are pushed in `registered` and rotated every 30 min as `ice-servers`. With a TURN
key (`wrangler secret put TURN_KEY_ID` / `TURN_KEY_API_TOKEN`, from Dashboard → Realtime →
TURN) the list always includes the relay ports firewalls leave open — UDP 3478/443, TCP
3478/80 and **TLS on 443/5349** (which passes HTTPS-only proxies); the server adds any of those
the API omits. **Without the TURN key only public STUN is served and users behind corporate
firewalls or symmetric NAT cannot get audio** — the hub logs a warning. Corporate IT may also
need to allowlist Cloudflare's four TURN addresses (see the Realtime TURN FAQ; they can change).

### Mobile (agent app)

Logs in at `/api/auth/employee-login` with `X-Client: mobile`, connects with `?token=`,
refreshes with `{refresh_token}` in the body and logs out the same way (both fixed: the TS
routes used to read a different field name, which would have signed a duty-mode phone out
every 15 minutes). A **closed** app is woken by device push: `POST /api/push/devices`
registers an FCM (Android) or APNs-VoIP (iOS, CallKit) token and the hub pushes on every ring.
Set `FCM_CREDENTIALS_JSON` and/or the `APNS_*` group to enable it; unset = off, and the
WebSocket ring still covers foregrounded and reconnecting apps. The push code is covered by
unit tests with real signing keys and mocked provider endpoints — **it has not been run
against live FCM / APNs**, which needs your credentials and a device.

### Chat hub (`chat-hub.ts`)

Same JSON envelope as the Rust hub. A customer can only join **their own** channel (everything
said in a joined channel is broadcast to its sockets). The staff board shows who is on a call
(`inCall`, pushed by the call hub). Messages persist to D1 idempotently on `clientMsgId`.

### Verification

`scripts/realtime-e2e.mjs` drives the built Worker (`wrangler dev`) with a web customer, a web
agent and a mobile-style agent: auth and Origin rules, role enforcement, mobile heartbeat,
call → answer → ICE → ICE restart, resume after a socket drop, escalation, agent-initiated
calls, channel isolation, mobile token refresh, and (with `SLOW=1`) ring timeout and grace
expiry. Run it against `wrangler dev` or a preview deploy; all checks pass.

## Cache & retry for store lookups

- **`cacheFirst(key, loader, { ttlMs, kvTtlSecs })`** (`src/lib/db/cache.ts`) —
  the port of the Rust app's moka cache-first reads. L1: per-isolate `Map`
  (bounded, TTL, LRU-ish). L2: Workers KV via the optional `CACHE_KV`
  binding — survives isolate eviction, shared across isolates/colos
  (eventually consistent, ≤60s; best-effort, never throws). No binding →
  memory-only, automatically.
  Cached today: brands, brand detail, default routes page, vehicle-type
  catalog, popular places, review tags, homepage stats
  (`src/lib/services/lookups.ts`); the public campaign list has its own
  cache — per-isolate copy + Workers Cache API, 10 s, claims write the exact
  slot count through, no KV (`src/lib/services/campaign-public.ts`). NEVER cached: seats, availability,
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
