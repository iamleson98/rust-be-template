# Real SQLite (begin-concurrent) swap — Opus design, 2026-11-15

Decision (owner): DROP the pure-Rust `rust-sql` engine entirely; use REAL C SQLite from the `begin-concurrent` branch so writers run concurrently. Target: small OVH VPS shared with k3s + quiz pod.

## 1. Build / link
- Vendor a begin-concurrent amalgamation in a patched copy of `libsqlite3-sys 0.30.1` (the version in Cargo.lock): `vendor/libsqlite3-sys/`, keep its prebuilt bindings, replace `sqlite3/sqlite3.{c,h}` + `sqlite3ext.h`. `[patch.crates-io] libsqlite3-sys = { path = "vendor/libsqlite3-sys" }`. sqlx's `sqlite` feature already enables `bundled` so `cc` compiles it (verify: `cargo tree -e features -i libsqlite3-sys`).
- `scripts/sqlite-amalgamate.sh <sha>`: clone github.com/sqlite/sqlite at sha (branch `begin-concurrent`), `./configure && make sqlite3.c`, copy files into vendor dir, write `PINNED` (sha + sqlite_source_id). Run inside debian:bookworm+tcl or local tclsh. Commit result (~9 MB).
- Pin: first begin-concurrent commit that contains tag `version-3.54.1` (check `git merge-base --is-ancestor version-3.54.1 <sha>`, VERSION file); merge `e80edc371c` (2026-10-16) likely. Else fall back to branch `begin-concurrent-3.51`. Plain WAL, no wal2.
- Add compile flags in patched build.rs: SQLITE_DQS=0, SQLITE_ENABLE_MATH_FUNCTIONS, SQLITE_LIKE_DOESNT_MATCH_BLOBS, SQLITE_DEFAULT_WAL_SYNCHRONOUS=1, SQLITE_ENABLE_UNLOCK_NOTIFY. Existing: FTS5, RTREE, STAT4, DBSTAT_VTAB, COLUMN_METADATA, THREADSAFE=1, USE_URI. Do NOT set DEFAULT_MEMSTATUS=0 (admin page reads status counters).
- Linux x86_64 glibc runtime image; no musl needed.

## 2. BEGIN CONCURRENT through sea-orm/sqlx
- sea-orm 1.1 sends plain BEGIN; sqlx 0.8.6 has `begin_with(stmt)`.
- Build `SqlitePool` yourself, wrap via `SqlxSqliteConnector::from_sqlx_sqlite_pool`. Per-connection options on `SqliteConnectOptions`: journal_mode WAL, synchronous NORMAL, busy_timeout 5s, foreign_keys ON, temp_store MEMORY, cache_size=-8192, mmap_size=268435456, wal_autocheckpoint=1000, journal_size_limit=67108864. (Bug: `apply_sqlite_pragmas` src/server.rs:631 only configures ONE pooled connection — fix.)
- Pool of 8 (any conn reads/writes); `/ready` pool of 2 stays. Process-wide `tokio::Mutex<()>` around COMMIT only; optional `Semaphore(4)` on open write txns.
- New `src/db/write.rs`: `ConcurrentTx` (Mutex<sqlx::Transaction<'static,Sqlite>>) implementing `sea_orm::ConnectionTrait`; `with_write(db, |tx| async {...})`: `begin_with("BEGIN CONCURRENT")` → body → commit. On sqlite error 517 (BUSY_SNAPSHOT) or 5 at commit: rollback, sleep 1–20 ms jitter, rerun whole body, up to 6 attempts; last attempt uses `BEGIN IMMEDIATE`. `:memory:`/non-WAL test pools always IMMEDIATE. Body must be side-effect free (collect HTTP/WS/jobs, fire after commit). DDL/migrations use the normal path.
- `StoreError` gets `Busy` (sqlx codes 5, 517, 6, 261); constraint errors (2067 etc.) map to `Conflict`, not retried. `retry.rs`: macro keeps retrying single statements; `Exhausted` from `with_write` is not retryable (no nested loops).
- Move every `.transaction(` / `.begin()` to `with_write`: store/booking.rs:443,541,571,604; store/campaigns.rs:421; payment_service.rs:891; seat_plan_db.rs:60; layout_catalog.rs:139; admin_service/{schedules.rs:501,527, bus_layouts.rs:176, vehicle_types.rs:180}. Helpers taking `&DatabaseTransaction` (e.g. campaigns::redeem_booking_coupon) become `&impl ConnectionTrait`.
- Hot paths: seat hold → ONE with_write (loser retry sees seat taken → Conflict). `trip_session.available_seats` decrement stays a single autocommit UPDATE after commit. Coupon reserve, unread counters, `job_queue.claim_next` stay single-statement autocommits. Inserts into one rowid table conflict at page level — accept + retry for now.

## 3. Ops
- DB files on local ext4 bind mount (never overlayfs/NFS); no unix-excl VFS.
- Background `wal_checkpoint(PASSIVE)` every 60 s, `TRUNCATE` nightly 04:00.
- Backup: every 6 h `VACUUM INTO '/app/data/backups/app-<ts>.db'` → gzip → existing S3/rustfs; rewrite deploy/backup.sh. (Litestream later possible.)
- Memory: cache 8 MiB/conn, mmap 256 MiB, `PRAGMA soft_heap_limit=134217728`; `DATABASE_CACHE_KIB` = per-connection, default 8192.
- Removing rust-sql also removes its global allocator: add `mimalloc` as `#[global_allocator]`; fix memory.rs / argon2 comments (purge_delay).
- D1 → SQLite import: freeze writes; `wrangler d1 export --remote --output d1.sql`; load into stage.db; integrity_check + foreign_key_check; fresh DB via migrator; ATTACH stage and `INSERT INTO t(cols) SELECT cols FROM stage.t` in FK order; skip `d1_migrations` and `_cf_*`; compare counts; ANALYZE. D1 dump has `PRAGMA defer_foreign_keys`, can't export virtual tables. The old RSQLDB05 app.db can't be opened by C SQLite.

## 4. Removal checklist
- `git rm rust-sql`, delete `.gitmodules`, `.cargo/config.toml`, tracked `app.db-rsqllock`; .gitignore `*.db-wal *.db-shm`.
- Cargo.toml: drop `exclude=["rust-sql"]`, `rustqlite-compat` dep, machete ignore; repoint patch + dev-dep libsqlite3-sys to vendor/; rewrite engine comment blocks.
- Delete `ENGINE_LINK` statics: src/db/mod.rs (rewrite to `sqlite_version()`/`sqlite_source_id()` + test vs PINNED), migrator/src/lib.rs:21-29, tests/{api_smoke,bus_layouts_admin,loyalty,staff_presence_upsert,route_media,migration_compat}.rs.
- src/routes/system.rs: remove `engine_stats` (573–711) → real SQLite status/PRAGMA values, show nothing when unavailable (honest numbers); rename `.rsql` probe to `.db`. src/cli/util.rs backend name+test; src/server.rs; config/mod.rs:110-134; memory.rs; auth/password.rs. Recheck rust-sql workarounds: lib.rs `repair_seaql_migrations_applied_at`, route.rs:245, layouts_canonicalize.rs:281.
- CI: ci.yml submodule/"Pull latest rust-sql" steps (221–235, 347–356, 378–384, 784–792), path regex line 172 → `^vendor/`, fmt/audit exclusions 260–266, 414–421; codeql.yml:59-66; deploy.yml:71-90,140 (label `sqlite.source_id`); review db-reset.yml, db-reindex.yml.
- Dockerfile 78–83, 107–118: copy vendor/; runtime adds sqlite3 CLI.
- taplo.toml:18, deny.toml:7, Makefile:67-71,163; delete scripts/export_db_schema.py + scripts/schema.sql; update README.md:149-173, docs/CI.md, docs/DEPLOYMENT.md, deploy/DB-SIZE-RUNBOOK.md.

## 5. Steps (one commit each; check passes before next)
1. Vendor crate + amalgamation script + patch; rust-sql removed. Check: `cargo test` green; test `sqlite_source_id()` == PINNED and `PRAGMA compile_options` has FTS5.
2. Hand-built pool, per-connection options, mimalloc. Check: all 8 conns report journal_mode=wal, cache_size, mmap_size.
3. `StoreError::Busy` + constraint mapping. Check: unit tests with fake sqlx errors 517/5/2067.
4. `ConcurrentTx` + `with_write` on a temp file DB. Checks: (a) A concurrent-inserts t1 uncommitted, B (busy_timeout 0) concurrent-inserts t2 and commits OK, then A commits OK — with IMMEDIATE B must fail; (b) A,B read+increment same row, A commits, B gets 517; (c) 16 tasks × 50 with_write increments → 800 and retry counter > 0; (d) forced conflicts still commit via IMMEDIATE fallback.
5. Move the 11 tx sites; seat hold = one tx. Check: booking/payment tests pass + 20 parallel holds on 1 seat → exactly 1 success, 19 Conflict, no leftovers.
6. Checkpoint task, `VACUUM INTO` backup job, new backup.sh. Check: backup during write loop passes integrity_check.
7. D1 import script (dry run on staging).
8. Docs + CI cleanup.

## 6. Unverified (check while building)
sea-orm row-conversion impls public? sqlx extended result codes on? BEGIN CONCURRENT needs no flag (unless SQLITE_OMIT_CONCURRENT)? auto_vacuum incompat (keep off). Which commit has 3.54.1. D1 export format vs migrator schema. Shared-cache in-memory test DBs may show SQLITE_LOCKED flakiness.
