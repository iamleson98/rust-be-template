# backend

A complete, 12-factor Rust backend built on a layered store architecture
(`CacheStore<RetryStore<DbStore>>`), with pluggable cache, storage, and
worker backends, JWT+refresh auth, RBAC, WebSocket, and full OpenAPI
documentation.

## Module map

```
src/
├── main.rs                 CLI: `backend` (start) | `backend migrate`
├── lib.rs                  crate root, module wiring, run_migrations()
├── config/                 typed .env config (figment)
├── error.rs                AppError → HTTP response mapping
├── state.rs                AppState (shared via Arc<AppState>)
├── server.rs               bootstrap + run + graceful shutdown
├── entity/                 SeaORM entities (reverse-from-DB schema)
├── migration/              SeaORM migrations (idempotent, run on startup)
├── cache/                  CacheBackend trait + MokaBackend / RedisBackend
├── store/                  Store trait + DbStore + RetryStore + CacheStore
├── storage/                FileStorage trait + Local + S3 + MinIO
├── worker/                 WorkerBroker trait + Redis + Db + Kafka (feature)
├── ws/                     in-process WebSocket hub (extensible)
├── rbac/                   cached role + permission checker
├── auth/                   password (argon2), JWT, refresh tokens, cookies, CSRF
├── middleware/             rate limit, AuthUser extractor, request id
└── routes/                 axum handlers + utoipa OpenAPI
```

## Stack

| Concern | Choice |
|---------|--------|
| Async runtime | tokio (multi-thread scheduler) |
| Web framework | axum 0.8 |
| ORM | sea-orm 1.1 (sqlx + Postgres) |
| Migrations | sea-orm-migration |
| Auth | jsonwebtoken + argon2 + HttpOnly cookies + double-submit CSRF |
| Cache | `moka` (in-process) or `redis` (shared) — pluggable |
| File storage | local filesystem, AWS S3, or MinIO — pluggable |
| Job broker | Redis, Postgres (`FOR UPDATE SKIP LOCKED`), or Kafka — pluggable |
| OpenAPI | utoipa + utoipa-swagger-ui |
| Compression | tower-http (gzip + brotli) |
| Rate limit | tower-governor (token bucket per IP, `/api/*` only) |
| Static files | tower-http::ServeDir with `Cache-Control` header |

## Quickstart

```bash
# 1. Configure environment
cp .env.example .env
# edit DATABASE_URL, JWT_SECRET, etc.

# 2. Apply migrations + start server
cargo run                       # or: cargo run -- serve

# 3. Visit the API
open http://localhost:8080/swagger-ui
```

## CLI

The binary exposes a `clap`-based CLI. Run `--help` to see all subcommands:

```
backend [OPTIONS] [COMMAND]

Commands:
  serve            Start the HTTP server (default if no subcommand)
  migrate          Manage database migrations (up / down / list / fresh)
  migration-new    Scaffold a new migration file under src/migration/
  entity-generate  Generate SeaORM entities from the live DB schema
  db               Database utilities (shell / reset / url)
  routes-list      Print all registered routes
  config-show      Print the resolved config (secrets masked)
  key              Generate secrets and hashes (generate / hash)
  db-backend       Print the DB backend the build supports
  help             Print this message or the help of the given subcommand(s)

Options:
      --config <CONFIG>  Override the config file path (default: reads .env`)
  -v, --verbose...       Increase verbosity (-v = warn, -vv = info, -vvv = debug)
  -h, --help             Print help
  -V, --version          Print version
```

### Common workflows

```bash
# Apply pending migrations
backend migrate up

# List applied / pending migrations
backend migrate list

# Revert the last 2 migrations
backend migrate down 2

# Drop all tables and re-apply all migrations from scratch (destructive)
backend migrate fresh --yes

# Scaffold a new migration (auto-registers in src/migration/mod.rs)
backend migration-new add_comments_table
# → creates src/migration/m20260807_120000_add_comments_table.rs

# Generate SeaORM entities from the live DB schema
# (requires sea-orm-cli installed: cargo install sea-orm-cli)
backend entity-generate

# Open an interactive DB shell (psql for Postgres, sqlite3 for SQLite)
backend db shell

# Print the DATABASE_URL (useful for scripts)
backend db url

# Generate a fresh 32-byte JWT secret
backend key generate

# Hash a password with argon2
backend key hash mypassword

# Inspect the resolved config (secrets masked)
backend config-show

# Print all registered routes
backend routes-list

# Print which DB backend the build supports
backend db-backend
```

### Verbosity

Use `-v` / `-vv` / `-vvv` to increase log verbosity:

```bash
backend -vvv serve    # trace-level logs
```

## Configuration

All config is loaded from `.env` (or actual env vars) via `figment`. See
[`.env.example`](.env.example) for the full list. Highlights:

| Variable | Default | Notes |
|----------|---------|-------|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/app` | Postgres DSN |
| `CACHE_BACKEND` | `moka` | `moka` or `redis` |
| `STORAGE_BACKEND` | `local` | `local`, `s3`, or `minio` |
| `WORKER_BACKEND` | `redis` | `redis`, `db`, or `kafka` |
| `JWT_SECRET` | (must override) | ≥32 bytes for HS256 |
| `RATE_LIMIT_RPM` | `60` | per-IP token bucket |
| `CORS_ORIGINS` | `http://localhost:3000,5173` | comma-separated |

## Database backend — SQLite (default) or Postgres

The DB layer is fully portable. Pick one at build time via cargo features:

```bash
cargo build                                       # default = SQLite
cargo build --no-default-features --features postgres
```

At runtime, the `DATABASE_URL` scheme selects which driver sea-orm uses:

```bash
DATABASE_URL=sqlite://./app.db?mode=rwc           # dev/CI
DATABASE_URL=postgres://user:pass@host:5432/db    # prod/scaling
```

### Why both

- **SQLite** for dev/CI/tests: zero-infra, instant startup, single file.
- **Postgres** for prod/scaling: real concurrency, `FOR UPDATE SKIP LOCKED`
  for the worker, native JSON/UUID types, replication.

### How portability is achieved

| Concern | SQLite | Postgres |
|---------|--------|----------|
| UUID columns | `uuid_text` (sea-orm portable alias) | `uuid` |
| Timestamps | `timestamp` (NaiveDateTime) | `timestamp` (NaiveDateTime) |
| JSON columns | `text` (parse with serde_json) | `json`/`jsonb` |
| Job dequeue | Atomic `DELETE ... WHERE id IN (SELECT ...)` | Same + `FOR UPDATE SKIP LOCKED` for concurrent safety |
| Seed inserts | SeaQuery builder (no `NOW()`) | SeaQuery builder (`current_timestamp()`) |

### What's NOT portable (and what to do about it)

- **`FOR UPDATE SKIP LOCKED`** — SQLite serializes writes so concurrent
  workers don't need it. The `DbBroker` conditionally compiles the lock
  clause via `#[cfg(feature = "postgres")]`. On SQLite, the simpler
  `DELETE ... WHERE id IN (SELECT ... LIMIT 1)` form is used.
- **JSON columns** — the `DbBroker` stores the job payload as `TEXT`
  (JSON string) on both backends so we don't depend on PG's `JSONB`.
  For domain tables that need JSON, store as `text` and parse with
  `serde_json` in your code.

### Switching backends

1. **Build with the right feature** (see above)
2. **Change `DATABASE_URL`** in `.env`
3. **Delete the old DB file / drop the schema** (migrations are
   idempotent but the table DDL differs slightly between dialects)
4. **`cargo run`** — migrations re-apply on the new backend

### SQLite gotchas

- `last_insert_rowid()` returns the integer autoincrement rowid, not
  the UUID PK. So `Entity::insert(model).exec_without_returning()` is
  used in `create_user` / `create_post` instead of `insert().exec()`
  which tries to refetch by rowid.
- No concurrent write transactions — only one writer at a time. The
  worker's `DbBroker` works but is single-threaded on SQLite.
- File-based — perfect for dev, but for prod use Postgres.

## Architecture: layered store

Every domain operation flows through two layers, each implementing the
same `Store` trait. Layers stack transparently:

```
HTTP request
   ↓
CacheStore<DbStore>                     ← Arc<dyn Store> in AppState
   │           │
   │           └─ SeaORM queries (1 round-trip per op) with #[retry]
   │              built into every async method (3 retries, exponential
   │              backoff 100ms→200ms→400ms). Mark methods #[no_retry]
   │              for non-idempotent operations.
   └─ Moka or Redis cache; only `get_user`, `get_post`, `get_user_permissions`
      cached. Other methods auto-delegate to DbStore.
```

### How `#[retry]` works

`#[retry]` is an attribute macro on `impl Store for DbStore`. For every
`async fn` in the impl, the macro:

1. Captures the original method body
2. Wraps it in an exponential-backoff retry loop
3. Preserves method args by cloning them before the loop (so each retry
   gets fresh values)

`DbStore` implements `RetryPolicy` (defaults: 3 retries, 100ms base,
exponential) — override any method on your struct to customize.

Adding a new `Store` method: add the impl on `DbStore` with the actual
SeaORM code — `#[retry]` picks it up automatically. Mark `#[no_retry]`
for INSERTs that generate new IDs (non-idempotent).


## Architecture: pluggable cache

`CacheBackend` trait — two backends:

- `MokaBackend` (in-process, lock-free LRU, ~10ns hits) — default for dev
- `RedisBackend` (shared across instances, ~0.3ms/hit) — for prod

Switch via `CACHE_BACKEND=moka|redis`. The `CacheStore` layer uses whatever
backend is configured.

## Architecture: pluggable file storage

`FileStorage` trait — three backends:

- `LocalStorage` — filesystem under `STORAGE_LOCAL_ROOT`, with path-traversal protection
- `S3Storage` — AWS S3 or any S3-compatible API (R2, B2, ...)
- `MinioStorage` — same S3 client pointed at MinIO endpoint with path-style addressing

Switch via `STORAGE_BACKEND=local|s3|minio`.

## Architecture: pluggable worker

`WorkerBroker` trait — three backends:

- `RedisBroker` — `BRPOP`/`LPUSH` list semantics, ~ms latency
- `DbBroker` — Postgres `FOR UPDATE SKIP LOCKED`, zero new infra
- `KafkaBroker` — rdkafka producer + consumer, high throughput at scale
  (requires `--features kafka` to compile in librdkafka)

Switch via `WORKER_BACKEND=redis|db|kafka`. The runner consumes jobs from
whichever broker is selected and dispatches to handlers registered in
`JobRegistry`. Per-job policies (`JobPolicy`: timeout, max attempts) are
registered with each handler, so a multi-hour job like the OSM import
gets its own budget instead of the 5-minute default.

## Architecture: scheduled (cron) background jobs

Recurring jobs — e.g. the **biweekly Vietnam OSM → Tantivy place-index
refresh** — run on the worker through a small scheduler:

- `scheduled_job` / `job_run` tables (migration `m20260903_000001`) —
  one row per schedule ("every N days at HH:MM" local wall-clock) and
  one row per execution (queued → running → succeeded/failed, with
  progress JSON, error, timing). `JobService` ticks (default 60 s),
  sweeps interrupted runs, enqueues due schedules onto the worker
  queue and advances the next slot (missed slots are skipped, not
  replayed — a server down for three weeks fires once on boot).
- The OSM import job (`src/jobs/osm_import.rs`) downloads the Geofabrik
  Vietnam extract, indexes into a **staging** directory with the
  low-resource profile (256 MB heap, 1 thread — slow but gentle on
  RAM/CPU), atomically swaps it into the live index, hot-reloads the
  running server's searcher (`PlaceService::activate` — no restart),
  and cleans up the ~500 MB PBF and leftovers on every exit path.
- Admin page `/admin/cron-jobs`: status, next run, work time, live
  progress, run history, "run now", enable/disable and cadence editing
  (`GET/PATCH /api/admin/cron-jobs`, RBAC `admin:cron-jobs:read|write`).

### Adding a new background job (the whole checklist)

The `jobs::catalog()` in `src/jobs/mod.rs` is the single registration
point — everything else picks a job up from it:

1. Write `src/jobs/<name>.rs`: a `JOB_TYPE` const, an async handler
   (decode `RunPayload` for the `job_run` row it reports into), and a
   `register(registry, deps)` fn installing it with a `JobPolicy`.
2. Add one `JobDefinition` entry to `catalog()` — job type, human
   description (shown on the admin page), default schedule (or `None`
   for trigger-only jobs).

The worker runner, boot-time schedule seeding, scheduler tick, admin
page and trigger API all consume the catalog; no other wiring. A
contract test (`every_catalog_entry_registers_a_handler_and_policy`)
keeps entries honest.

Config: `SCHEDULER_ENABLED` (default true; `false` = pure-API instance,
triggering returns 503), `SCHEDULER_TZ_OFFSET_MINUTES` (default 420 =
UTC+7, fixed offset — no DST in Vietnam), `SCHEDULER_TICK_INTERVAL_SECS`,
`SEARCH_OSM_DOWNLOAD_URL` (mirror override for the import's source).

## Architecture: WebSocket hub

`Hub` is in-process, keyed by `UserId`, with topic subscriptions. Cheap to
extend to a Redis Pub/Sub backplane later — the public API stays the same.

Protocol (text frames):
- `subscribe <topic>` — subscribe to a topic
- `unsubscribe <topic>` — unsubscribe
- `send <user_id> <body>` — direct message to another user
- anything else — broadcast to the user's own topic

## Architecture: RBAC

`RbacChecker` loads a user's permission set via the `Store` (which itself
caches in Moka/Redis), then exposes O(1) checks:

```rust
state.rbac.require(user_id, "posts:write").await?;
```

Permissions are codenames like `posts:write`, `users:read`. The seed
migration creates:

- `admin` role → all permissions
- `user` role → `posts:read`, `posts:write`, `users:read`

## Auth flow

1. **Register** — `POST /api/auth/register` → creates user + assigns `user` role
2. **Login** — `POST /api/auth/login` → sets HttpOnly cookies:
   - `access_token` (JWT, 15min)
   - `refresh_token` (opaque, rotating, 7d)
   - `csrf_token` (double-submit CSRF, 1h)
3. **API calls** — `AuthUser` extractor reads `access_token` cookie + verifies JWT
4. **Refresh** — `POST /api/auth/refresh` → rotates refresh token, issues new access
5. **Logout** — `POST /api/auth/logout` → revokes all refresh tokens, clears cookies

CSRF: double-submit pattern. Browser sends `csrf_token` cookie automatically;
mutating requests must also send `X-CSRF-Token` header with the same value.

## Build features

| Feature | Effect |
|---------|--------|
| `kafka` | Enables the Kafka worker backend (requires librdkafka) |

Default build is `cargo build`. For Kafka support: `cargo build --features kafka`.

## Service layer

Business logic lives in `src/service/`, between routes and store:

```
HTTP request → routes/* (thin) → service/* (business logic) → store/* (DB)
                                      ↓
                                 rbac + cache + auth helpers
```

### Design (informed by production Rust patterns)

After researching how production Rust codebases (realworld-axum-sqlx, axum-best, pipinghot.dev, smoketurner/rust-template) structure their state, we adopted a hybrid pattern that avoids the common pitfalls:

**`AppState` is `Clone` (cheap — every field is `Arc<T>`).** This is the idiomatic axum pattern: use `State<AppState>` directly, without an extra `Arc` wrapper. Axum clones the state per request, but each clone is just a refcount bump.

**Services are pre-built `Arc<T>` stored on `AppState`.** Constructed once at startup; shared via cheap `Arc` clones per request. **Never** construct services per-request — the refcount bump of a pre-built `Arc<Service>` is faster than allocating a new struct.

**Services hold their deps directly** (not a back-reference to `AppState`). This avoids circular `Arc` references — a common memory leak pitfall where `AppState` holds `Arc<Service>` and `Service` holds `Arc<AppState>`, creating a cycle that never gets freed.

**`AuthUser` extractor is generic via `FromRef`** — works with any state `S` where `Arc<JwtValidator>: FromRef<S>`, not just `AppState`. This makes it testable: in tests you can construct a tiny mock state that only holds a `JwtValidator` with test keys, and the extractor works the same.

### Why this pattern

| Pitfall avoided | How |
|-----------------|-----|
| Circular `Arc` refs (memory leak) | Services hold deps directly, not `Arc<AppState>` |
| God object bloat in tests | `AuthUser` is generic — works with a tiny mock state |
| Per-request service construction | Pre-built `Arc<Service>` on `AppState` |
| `RwLock` on hot paths | All fields are `Arc<T>` (lock-free reads) |
| `Extension<T>` runtime panics | Use `State<T>` (compile-time checked) |

### Services

| Service | Methods | RBAC | Holds |
|---------|---------|------|-------|
| `AuthService` | `register`, `login`, `refresh`, `logout`, `me` | None | store, jwt, jwt_validator, refresh, password, csrf, config |
| `UserService` | `list`, `get`, `delete` | `users:read`, `users:delete` | store, rbac |
| `PostService` | `list`, `get`, `create`, `update`, `delete` | `posts:write`, `posts:delete` | store, rbac |

Each service is `Arc<T>` so handlers can cheaply clone it (`state.auth.clone()`) if needed, or just call methods via `state.auth.method()` (deref through `Arc`).

### `FromRef` impls

`AppState` implements `FromRef` for its key components:

```rust
impl FromRef<AppState> for Arc<JwtValidator> { ... }
impl FromRef<AppState> for Arc<AuthService> { ... }
impl FromRef<AppState> for Arc<PostService> { ... }
impl FromRef<AppState> for Arc<UserService> { ... }
impl FromRef<AppState> for Arc<Config> { ... }
```

This lets extractors be generic — they declare what they need via `FromRef` bounds, and any state that can supply it works. In production that's `AppState`; in tests it can be a 3-field mock.

## Auth: JWT verification (no claims cache, revocation only)

JWT verification runs the full HMAC-SHA256 verify on every request — **we deliberately do not cache verified claims**. We DO cache revocation state (needed for logout correctness).

### Why no claims cache?

- **HS256 verify is already fast** (~5-10µs). At 10k req/s that's ~50ms of CPU/sec — ~5% of one core. Caching turns this into ~50ns hashmap lookups, but the absolute saving at typical QPS is negligible.
- **JWT is stateless by design.** The whole point of JWT vs. server-side sessions is no server lookup. Caching verified claims re-introduces server state, defeating the purpose.
- **Cache adds complexity for negative value.** Cache invalidation, `peek_claims` (insecure decode to peek at claims before verifying), memory overhead — all for negligible perf win.

### When claims caching IS worth it

- **RS256/ES256** (asymmetric). 50-100x slower than HS256 — caching pays off at much lower QPS.
- **OAuth2 token introspection** (`/tokeninfo` endpoint). 1-5ms per call — caching is essential.
- **>50k req/s per node** with HS256 — micro-optimization territory; benchmark first.

### What we DO cache (revocation only)

```
┌─ verify(token) ─────────────────────────────────────────────────┐
│                                                                  │
│  1. Full JWT verify (HMAC-SHA256 + exp + issuer + typ)          │
│     → trusted AccessTokenClaims                                 │
│     (no cache — always runs; ~5-10µs)                          │
│                                                                  │
│  2. Per-token revocation check                                  │
│     revoked.get(token_hash) → Some? → REJECT                    │
│                                                                  │
│  3. Per-user revocation check                                   │
│     user_revoked_at.get(claims.sub) → Some(revoked_at)?         │
│     if claims.iat <= revoked_at → REJECT                        │
│     (logout records `revoked_at = now` here)                     │
│                                                                  │
│  4. RETURN trusted claims                                        │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Logout = immediate revocation

JWT is stateless, so by default a logout doesn't invalidate the access token until it expires. We solve this with the per-user revocation cache:

1. `logout(user_id)` records `revoked_at = now` in `user_revoked_at`.
2. Next `verify(token)` checks `claims.iat <= revoked_at`. If true, reject.
3. The `<=` (not `<`) handles the case where login + logout happen in the same second.

The revocation entry's TTL is bounded by the access token's max lifetime — after that, the token would have expired anyway.

### Cache stats (revocation only)

- **Capacity**: 10k revoked tokens + 10k per-user revocations.
- **TTL**: equals access token TTL (default 900s).
- **Eviction**: TinyLFU.
- **Memory**: ~2 MB worst case.

### Comparison with Mattermost

Mattermost uses **server-side sessions** keyed by session ID (the JWT just carries the session ID). Their auth check is a DB/Redis session lookup, which IS the bottleneck — so they cache the session.

Our setup is stateless JWT, so the auth check IS the JWT verify (already fast). Caching verified claims would be a premature optimization that adds complexity for negligible gain. The only server state we keep is what's strictly necessary for logout correctness.

## Performance & resilience hardening

### Database

- **Connection pool with `max_lifetime`** — connections are recycled every 30 min by default to prevent DB-side idle kills. Configure via `DB_MAX_LIFETIME_SECS`.
- **`sqlx_logging: false`** by default — saves ~10% CPU on hot paths where every query log is wasted I/O.
- **Statement cache** — sqlx caches prepared statements per connection. Configure via `?statement-cache-capacity=100` in `DATABASE_URL` (sqlx 0.7+ syntax).

### Cache layer (resilience-first)

- **Cache read failures are non-fatal.** If Redis goes down briefly, requests fall through to the DB rather than 500'ing. Logged at warn, not propagated.
- **Cache write failures are non-fatal.** Subsequent reads will miss and re-fetch; cache self-heals.
- **Moka TinyLFU eviction** — keeps hot keys, evicts cold ones. Better hit ratio than LRU at the same memory budget.
- **Per-entry TTL via `Expiry` trait** — extends moka's `expire_after_create` so per-key TTL overrides become a 5-line change.

### Retry policy

- **Exponential backoff with jitter** — `base_delay * 2^attempt + up to 25% jitter`. Prevents thundering-herd retries when a recovering DB comes back online and 100 clients retry simultaneously.
- **Thread-local xorshift PRNG** — no global state, no extra deps, ~5ns per jitter call.
- **Non-retryable errors short-circuit** — `NotFound`, `Validation`, `Conflict` skip the retry loop entirely.

### RBAC checker

- **O(1) membership check** via `HashSet` built once per load.
- **Bulk check helpers** — `check_any` / `check_all` load permissions only once and check N permissions against the same set.
- **Cached via the store layer** — permission loads hit the cache backend (Moka/Redis), so cold load is the only DB round-trip.

### HTTP server

- **Per-request timeout** (default 30s) — protects against slow handlers + slowloris. Returns 408.
- **Request body size limit** (default 2 MB) — protects against memory DoS. Configure via `MAX_REQUEST_BODY_BYTES`.
- **TCP_NODELAY** — disables Nagle's algorithm for lower latency on small response writes.
- **TCP keepalive** — OS detects dead clients without holding connection slots forever.
- **Compression: gzip + brotli** — brotli is preferred by modern clients (10-20% smaller than gzip).
- **Pre-compressed static files** — `ServeDir::precompressed_gzip()` + `precompressed_br()` serve `.gz`/`.br` variants if they exist alongside the original. Generate them at build time with `gzip -k static/*` for max throughput.
- **Static file ETags + conditional requests** — `ServeDir` emits `Last-Modified` + `ETag` headers automatically and responds with 304 to `If-None-Match` / `If-Modified-Since`.

### WebSocket hub

- **Bounded channels (64 msgs per client)** — slow clients get a `try_send` drop instead of causing unbounded memory growth. Logged at warn so you can detect slow consumers.
- **Non-blocking broadcasts** — `try_send` never blocks the hub. A slow client doesn't delay broadcasts to other clients.
- **Per-user multi-connection support** — same user can have multiple WS connections across devices; broadcasts fan out to all of them.

### Worker

- **Backpressure by design** — each worker processes one job at a time. A slow handler doesn't dequeue the next job until done. The broker's queue absorbs bursts.
- **Panic isolation** — job handlers run in `tokio::spawn`'d sub-tasks. A panic doesn't kill the worker; the job is `nack`'d with the panic message and re-enqueued.
- **Nack with attempt counter** — failed jobs get `attempts += 1` and are re-enqueued. (Dead-letter queue pattern is a 10-line extension on top of this.)

### Graceful shutdown

- **SIGINT / SIGTERM** triggers `axum::serve`'s graceful shutdown, which drains in-flight requests before exiting.
- **No new connections accepted** during drain — load balancers should detect this via `/ready` returning 503.

## License

MIT
