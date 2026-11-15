# Master plan: Cloudflare → one Rust binary on the OVH VPS (Opus review, 2026-11-15)

REF = `.claude/worktrees/cf-ref` (behaviour to match). TARGET = `.claude/worktrees/rust-vps` (branch `feat/rust-on-vps`).
Inputs: `sqlite-plan.md` (approved, WP0), the search gap report, the route/feature gap report.

---------------------------------------------------------------------------------------------------
## A. Review of the two reports

### Spot-checks
| Claim | Verdict | Evidence / correction |
|---|---|---|
| UUIDs stored as 16-byte BLOB | **True, and it outlives rust-sql.** | It comes from sqlx-sqlite, not the engine: `Encode<Sqlite> for uuid::Uuid` binds a BLOB, and `Decode` accepts only BLOB. sea-orm `Value::Uuid` goes through that path. D1's 36-char TEXT ids would fail to **decode**, not just fail to match. Every `Uuid`/`Option<Uuid>` entity column needs `unhex(replace(x,'-',''))` on import. Columns typed `String` in entities (e.g. `chat_assignment.employee_id`) stay as text. |
| PBKDF2 in D1, Argon2 in Rust | **True, and higher impact than stated.** | `cloudflare/src/lib/auth/password.ts`: `pbkdf2$100000$<b64>$<b64>`, standard **padded** base64, SHA-256, 32-byte key. REF rehashes every Argon2 user to PBKDF2 on login (`needsRehash`), so most active users now hold PBKDF2. `src/auth/password.rs:130` parses only PHC, so all of them would be locked out. REF's Argon2 params (m=19456,t=2,p=1) equal `Argon2::default()`, so legacy Argon2 rows still verify. |
| MoMo / ZaloPay / VNPay broken | **Code claims true. Prod impact nil.** | `momo.rs:177-215` uses snake_case fields with no `rename_all` against MoMo's camelCase. `zalopay.rs` HMACs the raw body and expects a flat payload, but the real callback is `{data:"<json>",mac,type}` with the MAC over `data`. `vnpay.rs:79` formats dates in UTC. However, `cloudflare/wrangler.jsonc:93-97` sets `MOMO/ZALOPAY/VNPAY_ENABLED=false`, `VIETQR_ENABLED=true` and `PAYMENT_COD_ENABLED=true`. VietQR has no callback (staff confirm), so this is deferred (B8). |
| Anti-scraping blocks IPNs | **True, and the report under-states it.** | `/ipn/` is exempt only from the Referer rule (`anti_scraping.rs:200`). `/api/webhooks/{telegram,zalo,messenger,discord}` are exempt from **neither** the Referer rule nor the UA rule (`:179`, `:234-244`), so every chat-bot webhook gets a 403. Also, `X-Client: mobile` skips every rule, and anyone can send that header. That is acceptable only because rate limits still apply. Note it in the WP8 brief. |
| Customers hold `users:read` | **True.** | `m20260905_000010_seed_defaults.rs:152`, enforced at `routes/users.rs:101,127`. Fixing it needs a **data migration** (`DELETE FROM role_permissions …`), not only a seed edit, because fresh migrator DBs and any existing Rust DB both have the row. |
| New SPA copies over `frontend/src` with mechanical edits | **Mostly true, with three caveats.** | (1) Four imports reach outside the SPA: `@/lib/amenities`, `@/lib/city-match`, `@/lib/cities` (cities.json) and the type `@/lib/services/system-status`. (2) **REF's `spa/api/generated` is hand-maintained: there is no openapi.json anywhere in cf-ref.** The real contract test is `tsc` of the ported SPA against an SDK regenerated from Rust's utoipa spec. (3) TARGET has 83 vitest files plus `e2e/`, `e2e-admin/` and `ui-gallery` that will break. `next-themes` is already a TARGET dependency. |

### Omissions and errors
1. **Session continuity hinges on secrets nobody can read back.** Cookie names (`access_token` and `refresh_token`), claims, the issuer and the refresh HMAC (keyed by `JWT_SECRET`) match on both sides. Wrangler secrets cannot be exported, though. Without the owner's copy of `JWT_SECRET`, every web and mobile session (90-day mobile refresh tokens) ends at cutover. The same applies to OAuth client secrets, the push keys (APNs/FCM), Google Ads credentials and the TURN key.
2. **KV-backed token revocation** (`lib/auth/revocation.ts`, `CACHE_KV`) is not migrated. Up to 15 minutes of revoked access tokens become valid again. Accept this and note it in the runbook.
3. **Durable Object state** (`call-hub.ts` sessions, `chat-hub.ts` inCall) is ephemeral, so calls in progress drop at cutover. Schedule the cutover at night.
4. **`wrangler d1 export` refuses databases that contain virtual tables** (`place_fts*`, from migration 0001). Export per table (`--table`, repeated) or drop the FTS tables during the freeze. Dry-run this now.
5. **Timestamp format.** D1 writes `strftime('%Y-%m-%dT%H:%M:%fZ')` (migration 0005), and some rows may still hold the literal `(datetime('now'))`. Rust string-compares timestamps in SQL, so mixing `…Z` and sqlx's `…+00:00` breaks ordering and range filters. Normalise every DateTime column to exactly what sqlx writes, and reject any value that does not parse.
6. **Unique and FK constraint parity was only sampled** ("I did not compare every coupon index"). The import tool must diff every `UNIQUE` index and FK action programmatically.
7. **Service worker.** REF `sw.js` serves the app shell stale-while-revalidate. After cutover, returning visitors first get the cached Next shell, which requests `/_next/static/*`. Rust would 404 those requests and the page boots blank. Fix: serve the final Worker build's `_next/static` from Rust for 30 days, and bump the SW `VERSION` to `v3`.
8. **TURN regression.** REF uses Cloudflare Realtime TURN (`turns:` on 443, `turn-credentials.ts`). TARGET uses coturn with HMAC credentials, and this box has no public 443. Corporate or HTTPS-only networks would lose calls. See B1.
9. **REF #126 and #122 fixes the Rust side may also need:**
   - #126: partial PUTs on schedules, routes and bus layouts must keep omitted fields; pickup points need a lat/lon range check; schedule stops and fares must be written atomically.
   - #122: a push-woken phone must receive the ring with the caller id.

   Rust may already be correct here (childFare is fine), so these are *verify* items, not port items.
10. **Next.js redirects `/foo/` to `/foo` with a 308.** Rust serves 200 on both, which creates duplicate URLs. SEO detail.
11. **Rate limiting through the tunnel.** The socket peer becomes `127.0.0.1` (cloudflared), so `client_ip.rs` must trust `CF-Connecting-IP` only when the peer is loopback. Otherwise every user shares one bucket, a repeat of the 2026-10-15 load-test finding.
12. Rate-limit classes, CSP and Permissions-Policy are covered in the route report. However, REF's integration scripts (`cloudflare/scripts/{contract-sweep,ws-smoke,chat-flow,call-hub}-test.mjs`) send a Node UA, which TARGET blocks. The test harness must send a browser UA. These scripts are valuable as parity tests against Rust.
13. The memory numbers in the search report assume a dedicated 4 GB box. Here the extractor child (~610 MB peak) would land in the app's cgroup. See B1 and B4.
14. Rollback, mobile compatibility and cache invalidation are not covered by either report. See B6 and the risks below.

### Risks nobody listed
- **Data loss on import.** Sources: writes during export (fix: freeze), virtual-table export failure, TEXT UUIDs, timestamps, orphan rows (D1 FK enforcement history), seeded-table id collisions, and `trip_session.available_seats` drift. Mitigations: freeze, a decode-every-row check, `foreign_key_check`, recomputing seat counters, and keeping the D1 snapshot read-only for 30 days.
- **Cache invalidation.**
  - Cloudflare does not edge-cache JSON by default. Confirm the zone has no "Cache Everything" rule, or it would cache cookie-bearing HTML.
  - `/assets/*` is immutable. Keep the previous release's `assets/` beside the new one for one release, so open tabs can still lazy-load chunks.
  - In-process moka caches start empty after import.
- **SEO.** Today every page declares the home page as canonical (`frontend/index.html:34`). There is no 404 status, the sitemap is static, and 600 s HTML is cached at the edge in REF. All of this is handled by WP8. URLs stay the same, so ranking risk is low if the 404 and canonical rules land **before** cutover.
- **WebSocket and call paths.** `/ws` and `/ws-call` through Cloudflare's proxy hit a 100 s idle cutoff on the free plan. Server pings must stay under 60 s (verify `ws/hub.rs`). The call relay depends on B1.
- **Memory on a shared box.**
  - Consumers: the k3s agent (~350 MB), the quiz pod (≤256 Mi), cloudflared (~40 MB), and the app (~100 MB base + ~235 MB place index + 64 MB SQLite caches + 2×19 MiB Argon2).
  - Peaks: +250 MB for ~2 s while swapping in a new index generation, and ~610 MB for the extractor.
  - SQLite mmap pages are charged to the cgroup but can be reclaimed.
  - Steady state is about 1.3 GB, which fits 2 GB only if the extractor runs in its own capped unit.
- **Mobile app.**
  - `mobile/` is identical in both trees and uses the same host and paths with `X-Client: mobile`. Compatibility needs the same JWT secret and an unchanged `/api/auth/*` contract.
  - Push credentials must be configured in Rust before cutover.
  - Run REF's `call-hub-test.mjs` against Rust to cover the mobile call traffic from #122.
- **Rollback.**
  - Moving DNS back to the Worker is instant.
  - Data written in Rust after cutover has no path back to D1.
  - Hence the policy in B6.

---------------------------------------------------------------------------------------------------
## B. Decisions

**1. Topology (recommend: Cloudflare as DNS, proxy and Tunnel only; Rust under systemd; no Caddy; no public 80/443).**
- **Ingress:** the existing `datxevui-vps` cloudflared tunnel gets public-hostname ingress rules: `datxevui.com` and `www.datxevui.com` → `http://127.0.0.1:8080`.
  - TLS terminates at Cloudflare. The origin stays hidden and nothing is opened inbound.
  - This also avoids any fight with k3s ServiceLB/Traefik over host ports 80 and 443.
  - Rollback is a DNS/route flip.
  - Optionally, a Cloudflare redirect rule sends `www` → apex with a 301.
- **Process:** a systemd unit `datxevui.service` modelled on `vps/deploy/vps-service.service`.
  - User `datxevui`, `StateDirectory=/var/lib/datxevui` (holds `app.db`, `uploads/`, `places/`, `backups/`).
  - Listens on `127.0.0.1:8080`.
  - Limits: `MemoryHigh=900M`, `MemoryMax=1300M` (2 GB box) or 1500M/2G (4 GB box). `MALLOC_ARENA_MAX` is irrelevant with mimalloc.
  - Same sandboxing as vps-service.
  - Releases use the signed pull timer from REF `vps/update.sh` (tarball: binary + `dist/` + legacy `_next/`).
  - **No Docker:** this is a k3s/containerd node, and dockerd adds ~100 MB plus iptables churn. `deploy/stack.yml` (Swarm) stays for other hosts, but this box doesn't use it.
- **Firewall (ufw):** SSH only, as today. k3s agent traffic (10250/tcp from the server, 8472/udp flannel) follows the existing rules.
- **Calls:** keep **Cloudflare Realtime TURN**. Rust gets a `cloudflare` value for `AUDIO_CALL_TURN_AUTH_MODE` that mints credentials from `TURN_KEY_ID`/`TURN_KEY_API_TOKEN`, as `turn-credentials.ts` does. This keeps parity, including `turns:443`, with zero open ports. coturn remains possible later; it would need 3478/udp+tcp and a relay range.
- **Coexistence:** the app never binds 0.0.0.0. Before install, check `ss -ltnup` for collisions on 8080.
- **vps-service:** stop it at cutover. It is replaced, and the Worker's static-shard fallback and its own cron trigger cover a rollback.

**2. SEO/SSR (recommend: Rust injects the head; no body SSR, matching REF).**
- REF renders only the `<head>` (title, description, canonical, robots, OG/Twitter, FAQ JSON-LD on the home page, hero preload on home) plus a 404 for unknown paths (`app/[[...slug]]/page.tsx`).
- Port `spa/lib/seo.ts` (111 lines: `PAGES`, `matchPage`, `pageSeo`, `CANONICAL_PARAMS`) to `src/web/seo.rs`.
- `index.html` carries `<!--app-head-->`. Rust replaces it per request.
  - Brand facts come from the DB through a 60 s moka cache (a missing brand gives 404).
  - The vi strings come from `dist/seo-strings.json`, emitted by the frontend build.
- Parity is locked by a golden file, `tests/fixtures/seo-golden.json`, generated by running REF's `pageSeo` over about 40 paths. A Rust test compares against it.
- Keep `prerender.mjs` only for `/privacy` and `/terms` body text (payment-provider reviewers). Drop `entry-server` otherwise.
- Live `sitemap.xml` (static pages + active brands + one corridor page per active route city pair). Add `ads.txt`. Add a 308 trailing-slash redirect.

**3. WebP vs JPEG (recommend: WebP, as REF does).**
- Migrated R2 objects are already WebP (`t{hash}.webp`, `brands/logos/{sha16}.webp|svg`), and the SPA expects those keys.
- Use the `webp` crate (bundled libwebp via `cc`, the same build model as vendored SQLite) for lossy encoding:
  - Route pictures: 1920 px, plus a 640 px thumbnail.
  - Brand logos: 512 px.
  - Quality values copied from REF `route-media.ts` and `image-encode.ts`.
- Pictures are capped at 10, EXIF is dropped by re-encoding, and SVG logos are stored as-is.
- `/api/media` sends `content-security-policy: default-src 'none'; style-src 'unsafe-inline'; sandbox`.
- `image-webp` (lossless only) is rejected because it produces huge files.

**4. Place search (recommend: an in-process module; extraction in its own systemd unit; no static shards).**
- Copy `vps/src/places/{engine,lexicon,text,mod,tests}.rs` into `src/places/`, and copy `tools/place-extract` as a workspace member.
- `ArcSwapOption<Engine>` lives in `AppState`.
- `datxevui-places.timer` runs weekly (Mon 03:30 ICT) and calls `datxevui places-build`:
  - The service runs with `Nice=19`, `IOSchedulingClass=idle`, `MemoryMax=800M`.
  - Flow: Geofabrik MD5 skip → download → extract → validate (size, shrink ≤20%, smoke queries) → write `places/gen-<ts>/records.bin` → flip the `current` symlink → keep the previous generation.
- The app polls `current` every 60 s and swaps the engine in. At boot it loads the last generation from disk.
- Static shards are dropped. Before the first generation exists (first install only, and the runbook builds one before cutover), the routes answer `{items:[],engine:"unavailable"}` with `max-age=60`. `engine` is otherwise `"index"`.
- Delete `src/osm/{schema,searcher,indexer,osm_reader,spatial,vn_text}.rs` and the `tantivy` dependency. Keep `osm/download.rs`.

**5. PBKDF2 (recommend: verify and rehash to Argon2).**
- `password.rs` accepts `pbkdf2$<iter>$<b64>$<b64>`: iterations from 1 to 1,000,000, a padded standard base64 decode, and a constant-time compare. Use the `pbkdf2` crate (`hmac` feature) with the existing `sha2`, running on the existing Argon2 worker threads.
- After a successful login with a non-Argon2 hash, rehash to Argon2id and store it.
- Unknown-email timing is equalised by verifying a decoy hash.
- Test with a vector generated by REF `hashPassword` (Node WebCrypto), committed as a fixture.

**6. D1 → SQLite import and cutover (recommend: a Rust CLI `datxevui import-d1`, a WAF write-freeze, and fix-forward after T+2h).**
- **Tool:** `import-d1 --stage stage.db --out app.db --report report.json`.
  1. Run the migrator on a fresh `out`.
  2. Delete the migrator-seeded rows in `roles`, `permissions`, `role_permissions`, `vehicle_type` (and any other seeded table the tool detects) and import D1's rows in their place. D1 already lacks `users:read` for `user`.
  3. Copy tables in FK-topological order, computed from `pragma foreign_key_list`.
     - Rename `nullclaw_exchange` to `null_claw_exchange`.
     - Columns are matched by name. Per-column transforms come from the TARGET entity column type: Uuid → BLOB (strict 36-char check); DateTime → the sqlx canonical format (fail on unparseable values, map the literal `(datetime('now'))` to the row's created_at or the import instant and report it); bool → 0/1; JSON columns validated.
     - `schedule.days_of_week` JSON (1..7, Sunday=1) is converted to a 7-char mask.
     - D1-only columns (`chat_channel.realtime_meeting_id`) are dropped and reported.
     - Skip `d1_migrations`, `_cf_*`, `place_fts*` and `job_run`.
  4. Recompute `trip_session.available_seats`.
  5. Run `integrity_check`, `foreign_key_check`, and compare counts.
  6. **Decode every row of every entity through sea-orm** (`Entity::find().all()`) as the acceptance proof.
  7. `ANALYZE`.
- **Export:** `scripts/d1-export.sh`, per-table `wrangler d1 export --remote --table …`, then `sqlite3 stage.db`.
- **Objects:** `scripts/r2-sync.sh` runs `rclone copy r2:datxevui-uploads /var/lib/datxevui/uploads` with the same keys. Pre-sync at T-1d, delta at T-0, and verify counts and sizes.
- **T-7d:** staging on `staging.datxevui.com` through the same tunnel (Cloudflare Access-protected). Nightly import dry run from prod D1. Parity harness. 24 h soak with memory watched.
- **T-0** (01:00 ICT, about 30 min of write downtime):
  1. A Cloudflare WAF custom rule returns 503 for non-GET `/api/*`.
  2. Remove the Worker cron trigger and stop vps-service.
  3. Final export and R2 delta.
  4. Import and checks.
  5. Start `datxevui.service`. Smoke-test via staging.
  6. Move the `datxevui.com`/`www` custom domains from the Worker to the tunnel hostnames.
  7. Remove the WAF rule.
  8. Smoke-test production and mobile.
- **Rollback:**
  - Until T+2h: flip DNS back to the Worker, restore its cron, and restart vps-service. Bookings, users and messages created in Rust are re-entered by hand from `GET /api/admin/bookings/export` and the audit log. Expect a handful at night.
  - After T+2h: fix-forward only.
  - Keep the Worker, D1 (read-only snapshot) and R2 for 30 days, then delete.

**7. Features to drop.**
- Drop:
  - Next.js/OpenNext shell, `page-cache.ts` (the Rust head render is cheap).
  - D1/drizzle, KV, R2 (moves to local disk + backups), the Images binding (moves to libwebp).
  - Durable Objects (Rust `ws/` hubs replace them), Workers rate-limit bindings (moves to governor classes).
  - The cron trigger, `/api/jobs/tick`, `CRON_ALLOWED_IPS`.
  - vps-service: `/v1/*`, the Workers VPC binding, `VPS_SERVICE_TOKEN`.
  - Static place shards (`/places/*`, `build-place-shards.ts`).
  - `/api/admin/stats` (dead), `/api/health` (Rust has `/health`), the RealtimeKit column, `wrangler.preview.jsonc`.
  - REF's admin-system Worker/VPS cards.
- Keep:
  - TARGET's admin system page (host, DB and process cards per sqlite-plan), with a place-index card and a jobs card added.
  - TARGET's `SitePresence` socket.
  - NullClaw, off.

**8. Payment gateways.** Prod runs VietQR (manual confirm) + COD only, per `wrangler.jsonc:93-97`.
- Ship with MoMo, ZaloPay and VNPay disabled, and make an enabled-but-misconfigured provider fail closed at boot.
- Do now: the IPN/webhook exemption (WP8) and the "check enabled before moving the hold" ordering (WP7a).
- Defer: the MoMo camelCase, ZaloPay `{data,mac}` and VNPay GMT+7 fixes, to WP-P, before any gateway is enabled.

---------------------------------------------------------------------------------------------------
## C. Work packages

### Ownership rules (contention points)
- `Cargo.toml`/`Cargo.lock`: WP0, then WP1 only. WP2 may delete only the `tantivy` line. Anything else goes through WP12.
- `migrator/src/lib.rs` and `migrator/src/migration/*`: WP1 only. Late schema needs go to WP12.
- `src/config/mod.rs` and `src/cli/parser.rs`: WP1 only. WP1 pre-adds every config field and CLI subcommand stub listed below.
- `src/state.rs` and `src/server.rs`: WP0, then WP2 only.
- `src/routes/router.rs` and `src/middleware/**`: WP8 only. WP1 pre-adds the `.nest("/uploads", routes::uploads::router())` stub.
- `src/routes/openapi.rs`, `frontend/openapi.json` and `frontend/src/api/generated/**`: **WP12 only.** Feature WPs end their report with "handlers/schemas to register".
- `frontend/**`: WP9a and WP9b only.
- Tests: new files only, named `tests/wpN_*.rs`. Shared test helpers are read-only (WP13 owns them).
- Every Rust WP must pass `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings` on latest stable **and** `cargo +nightly clippy` (CI uses the newest Rust), and `cargo test`. Every frontend WP must pass `bun run typecheck && bun run lint && bun run test && bun run build`.
- One branch per WP off `feat/rust-on-vps` after its dependencies merge. The integrator merges them in the wave order below, never force-pushes, and merges upstream into the branch.

### Fixed interfaces (lets the waves run in parallel)
- `index.html` contains `<!--app-head-->`.
- `bun run build` emits `dist/seo-strings.json` (`{key: viText}` for every key `seo.ts` uses).
- `tests/fixtures/seo-golden.json` holds entries of the form `[{path, search, facts, expect:{title,description,canonical,robots}|null}]`.
- Place hit: `{id,name,nameNoTones,type,province,district,ward,lat,lon,score}`. Response: `{items, engine:"index"|"unavailable"}`.
- CLI: `datxevui places-build [--force]` and `datxevui import-d1 --stage --out --report`.
- Place store: `/var/lib/datxevui/places/{gen-<ts>/records.bin, current -> gen-…}`.
- New config fields (WP1), each with a default:
  - `PLACES_DIR`, `PLACES_PROFILE=all`
  - `RATE_LIMIT_STRICT_RPM=100`, `RATE_LIMIT_AUTH_PER_MIN=10`, `RATE_LIMIT_WRITE_PER_MIN=30`
  - `CLIENT_IP_SOURCE=cf-connecting-ip|xff`
  - `AUTH_LOCKOUT_MAX_FAILURES=5`, `AUTH_LOCKOUT_SECS=900`
  - `GOOGLE_ADS_API_VERSION=v21`
  - `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` (`AUDIO_CALL_TURN_AUTH_MODE` gains `cloudflare`)
  - `LEGACY_NEXT_DIR`

### Packages
| WP | Goal | Owns (exclusive) | Deps | Acceptance | Size | Model / effort |
|---|---|---|---|---|---|---|
| **R1** | Doc research notes to `scratchpad/research.md`: cloudflared WS idle timeout and which IP headers it forwards; `wrangler d1 export` flags and the virtual-table limit; the Cloudflare Realtime TURN credential API; `webp` crate lossy API and build needs; k3s agent ports, ufw and ServiceLB host-port behaviour on agents | none in repo | – | Each answer cites a doc URL | S | Haiku / medium |
| **WP0** | SQLite swap (sqlite-plan.md, in progress) | per sqlite-plan | – | sqlite-plan §5 checks | L | Sonnet / high (running) |
| **WP1** | Foundation | `Cargo.toml`/lock (adds `pbkdf2`, `webp`, `fst`[levenshtein], `unicode-normalization`, `md-5`, `indexmap`, `arc-swap`); `tools/place-extract/` (copied, workspace member, `include_str!` repointed to `data/cities.json`); `data/cities.json` (REF copy); `src/cities.rs` (+`hung-yen`, count test 63); `src/config/mod.rs` (fields above); `src/cli/parser.rs` + stub `src/cli/import_d1.rs` + stub `src/places/build.rs`; stub `src/routes/uploads.rs` + its nest line in `router.rs`; migrations `m20261116_000023_address_city_id` (column + REF 0009 backfill), `…000024_user_role_drop_users_read` | WP0 merged | `cargo test`; migration test: fresh DB, `user` role lacks `users:read`; `address.city_id` backfilled on a fixture; `cargo build -p place-extract` | S/M | Sonnet / medium |
| **WP2** | Place engine (B4) | `src/places/**`, `src/osm/**` (delete all but `download.rs`), `src/jobs/osm_import.rs` (removed from in-app scheduler), `src/jobs/mod.rs`, `src/service/place_service.rs`, `src/dto/place.rs`, `src/routes/places.rs`, `src/state.rs`, `src/server.rs`; delete the `tantivy` line | WP1 | Copied `places/tests.rs` pass. Route tests: blank `q` → popular; `lat` without `lon` → 400; `???` and `a:b` → 200 empty; Cache-Control 300 (search), 3600 (list, reverse), 60 when unavailable. Reverse returns nearest first. A generation swap under load gives no 5xx. `cargo tree -i tantivy` is empty. RSS with a real extract ≤ 300 MB steady (manual, reported) | L | Sonnet / high |
| **WP3** | Public catalog + trip search parity + brand profile | `src/routes/public.rs`, `src/service/public_service.rs`, `src/service/trip_search.rs`, `src/store/trip.rs`, `src/store/brands.rs`, `src/dto/public.rs`, new `src/service/brand_profile.rs`, `src/service/routing_service.rs`, `src/routes/routing.rs`, amenity label helper | WP1 | Tests: geo `fromCity`+`toCity` merge and trips with no-coord stops sort last; inactive-brand trips excluded before facets; recommendations use `local_today`, order by date then schedule time, and build real cards; `/api/routes` returns city lat/lon; brands order rating→total_trips→name; non-UUID `brand_id` → 400; routing unconfigured → 503; `2026-1-5` → 400; `cityId` on `TripSchedulePoint`/`TripEndpoint`; `GET /api/brands/{slug}/profile` caps (60 locations, 40 trips, 3 days), 404 for inactive brands. Port key cases from REF `cloudflare/tests/unit/*trip*` | L | Sonnet / high |
| **WP4** | Admin catalog parity | `src/routes/admin/{addresses,schedules,bus_layouts,pickup_points,routes,brands,vehicle_types}.rs`, `src/service/admin_service/**`, `src/service/admin_service.rs`, `src/dto/admin.rs` | WP1 | `cityId` required and validated on address create; DELETE an in-use address → 409; blank detail cleared, empty name rejected; `stopCount`; `bus-layouts?brandId&includeShared=true`. Verify-or-fix the #126 list: omitted PUT fields kept (schedule layout and vehicle type, route brand, layout brand); lat/lon range checked; stops and fares atomic. One test per item | M | Sonnet / medium |
| **WP5** | Media: WebP, route pictures, brand logo (B3) | `src/service/route_media_service.rs`, `src/routes/admin/route_pictures.rs`, `src/routes/media.rs`, `src/routes/uploads.rs`, new `src/media/encode.rs` | WP1 | Uploads re-encode to WebP 1920 + 640 thumbnail; cap 10; `t{hash}.webp` and `brands/logos/*` keys parse; logo 5 MiB cap, jpg/png/webp→WebP 512, SVG kept; media responses carry the sandbox CSP; a polyglot or corrupt file → 400; no EXIF in output | M | Sonnet / medium |
| **WP6** | Auth parity (B5) | `src/auth/**`, `src/service/auth_service.rs`, `src/store/users.rs`, `src/routes/auth.rs`, `src/routes/oauth.rs` | WP1 | PBKDF2 fixture logs in and the row becomes `$argon2id$`; lockout after 5 failures for 15 min; OAuth onto an unverified password account clears the password, revokes refresh tokens and marks the email verified; first admin chosen atomically (20 parallel registrations → 1 admin); name length in chars; phone-only registration; logout checks the owner first; mobile password change → 90-day mobile session; deleted user → 401; refresh token minted by REF code with the same secret is accepted (fixture) | M | Sonnet / high |
| **WP7a** | Ads, reviews, payment ordering | `src/ads/**`, `src/routes/ads.rs`, `src/service/review_service.rs`, `src/dto/review.rs`, `src/store/review.rs`, `src/routes/reviews.rs`, `src/service/payment_service.rs`, new fns in `src/store/booking.rs` | WP1 | Conversion: only `booking`/`purchase`, a real booking code, DB value and currency, purchase needs a completed payment; Ads API version from config; editing an approved review → pending; 5000 chars counted as chars; "departed" uses the VN instant; `topTags` reads JSON and CSV; provider enabled is checked before the hold moves; gateways fail closed when misconfigured | M | Sonnet / medium |
| **WP7b** | Chat and calls parity | `src/service/chat_service.rs`, `src/routes/chat.rs`, `src/routes/admin/chat.rs`, `src/ws/**`, `src/audio_call/**`, `src/presence/**` | WP1 | Reuse `open`/`assigned` channels; staff queue ordered by last activity then created; `botActive` presence frame; `cloudflare` TURN mode mints credentials (mock HTTP); server WS ping ≤ 50 s; #122 push-woken ring carries the caller id (test or proof of existing behaviour); REF `call-hub-test.mjs` and `chat-flow-test.mjs` pass against local Rust (browser UA) | M | Sonnet / high |
| **WP8** | Edge: HTTP, SEO, security (B2) | `src/routes/router.rs`, `src/middleware/**`, `src/routes/seo.rs`, new `src/web/{mod,seo,head}.rs`, `tests/fixtures/` (reads the golden file) | WP1 (golden file from WP9a can arrive later; stub it first) | Golden SEO test passes; unknown path → 404 with the SPA body; `/foo/` → 308; home-only JSON-LD and preload; live sitemap (brands + corridors, no `/login`); CSP floor and Permissions-Policy on every response; static Cache-Control matches REF `_headers` (fonts, icons, hero, logo: 1 d + SWR 7 d; `sw.js` no-cache); `/_next/static/*` served from `LEGACY_NEXT_DIR`; rate-limit classes (read 600, strict 100 on search, recommendations, auth, uploads, ads, vitals and WS upgrade; auth 10/min; write 30/min; IPv6 /64); `CF-Connecting-IP` trusted only from a loopback peer; `/api/payments/ipn/*` and `/api/webhooks/*` exempt from the UA **and** Referer rules; public-cache layer on `/api/reviews`, `/api/reviews/stats`, `/api/brands/*/profile` (query ignored for profile) | L | Sonnet / high |
| **WP9a** | Frontend port | `frontend/**` except tests | none (start now, with REF's generated SDK copied temporarily) | Copy `cf-ref/cloudflare/src/spa` → `frontend/src`. Mechanical edits: `@spa/`→`@/`, `process.env.NODE_ENV`→`import.meta.env.MODE`, prettier style. Drop `spa-mount.tsx`, `router/history.ts`, `spa-env.d.ts`. Inline the four `@/lib` deps. Keep TARGET's `entry-client`, `features/admin/system/*`, `chat/site-presence.tsx`, `prerender.mjs` (privacy and terms only). Merge i18n (REF keys + TARGET `adminSystem`). `<!--app-head-->`; `scripts/emit-seo-strings.mjs`; `scripts/seo-golden.mjs` → `../tests/fixtures/seo-golden.json`; `public/ads.txt`; `public/sw.js` VERSION `v3`. typecheck, lint and build green | L | Sonnet / high |
| **WP9b** | Frontend tests | `frontend/src/**/__tests__`, `frontend/e2e*`, `frontend/ui-gallery*` | WP9a | Vitest green; obsolete tests deleted with a reason in the commit; new tests for brand page, payment-return, picture slider, seo helpers | M | Sonnet / medium |
| **WP10** | D1 import + R2 sync (B6) | `src/cli/import_d1.rs`, `scripts/d1-export.sh`, `scripts/r2-sync.sh`, `tests/wp10_import.rs`, `tests/fixtures/d1/` | WP1; WP6 for the login test | Fixture = REF migrations 0000-0009 + `seed_cf.py` + synthetic rows covering every table (TEXT UUIDs, `…Z` timestamps, a literal `(datetime('now'))`, JSON `days_of_week`, pbkdf2 user). Import: every entity decodes; counts equal; `foreign_key_check` empty; programmatic UNIQUE and FK diff report; the pbkdf2 user logs in on the imported DB; seat counters recomputed. A dry run on a real prod export is run by the owner (WP14) | L | Sonnet / high |
| **WP11** | Deploy and ops (B1) | new `deploy/vps/**` (units `datxevui.service`, `datxevui-places.{service,timer}`, `datxevui-backup.{service,timer}`, `update.sh` from REF, `cloudflared-ingress.yml` example, `bootstrap.sh` delta), new `.github/workflows/release-vps.yml` (x86_64 glibc build + dist + legacy `_next` → signed tarball), `docs/CUTOVER.md` (runbook = B6) | WP0 (backup command) | `systemd-analyze verify` on units; `shellcheck`; release workflow dry run on a tag in a fork or via `act`; runbook reviewed at G4 | M | Sonnet / medium |
| **WP12** | Contract integration (serial) | `src/routes/openapi.rs`, `frontend/openapi.json`, `frontend/src/api/generated/**`, late `Cargo.toml` and migration requests | WP2-8, WP9a | `cargo test --lib dump_openapi_spec_for_the_frontend_sdk`; `bun run openapi`; the ported SPA typechecks against the Rust SDK; `diff` of REF `types.gen.ts` vs the new one, with each remaining difference listed and justified | M | Sonnet / high |
| **WP13** | Parity harness + smoke | `scripts/parity/**`, `frontend/e2e-smoke/**` + `playwright.smoke.config.ts`, shared `tests/common/**` | WP10, WP12 | (a) Differential run: REF `wrangler dev` (local D1 from the fixture) and Rust (import of the same fixture) answer about 150 GET requests (search/geo/places/brands/profile/routes/recommendations/reviews/trip detail). Volatile fields normalised; zero unexplained diffs. (b) REF `contract-sweep`, `ws-smoke`, `chat-flow`, `call-hub` scripts green against Rust. (c) Playwright against `cargo run` serving `dist`: home → search → trip detail → seat hold → VietQR page; login (pbkdf2 user); brand page; admin brand edit + picture upload; 404 page; map place search | M/L | Sonnet / high |
| **WP14** | Staging soak and cutover rehearsal | none (ops) | all | Real prod export imported on staging with a clean report; 24 h soak (RSS within MemoryHigh, no 5xx spike, the places timer runs inside its cap); rollback rehearsed once | M | Owner + Sonnet / medium |
| **WP-P** | Gateways (deferred) | `src/payment/{momo,zalopay,vnpay}.rs`, `src/routes/payments.rs` | WP7a | Sandbox vectors from the providers' docs | M | Sonnet / medium |

### Waves
- **Now, parallel with WP0:** R1, WP9a, WP11.
- **After WP0 merges:** WP1, serial and quick.
- **After WP1:** WP2, WP3, WP4, WP5, WP6, WP7a, WP7b, WP8, WP10 in parallel (file sets are disjoint); WP9b runs once WP9a is done.
- **Serial:** WP12 → WP13 → WP14 → cutover.

### Opus review gates
- **G0:** after WP0 (concurrency tests, pool pragmas, memory).
- **G1:** after WP2 + WP3 (search parity, ranking samples, cache headers).
- **G2:** after WP6 + WP8 (auth and security diff review, rate limits, client IP, SEO golden file).
- **G3:** after WP10 on a real export (import report, decode proof, constraint diff).
- **G4:** pre-cutover (WP12 SDK diff list, WP13 diffs, soak numbers, runbook, secrets checklist).
- **G5:** at T+24h (logs, 4xx/5xx, memory, sitemap fetch in Search Console).

---------------------------------------------------------------------------------------------------
## D. Owner questions (blocking only; my default in brackets)
1. **Do you hold copies of `JWT_SECRET` (plus `JWT_ISSUER`), the OAuth, push, Ads and TURN secrets?** Wrangler cannot export them. [Default: reuse them; if `JWT_SECRET` is lost, everyone signs in again, mobile included.]
2. **RAM: 2 GB or 4 GB?** (Run `free -m` on 15.235.247.54.) [Default: budget for 2 GB, with the extractor capped at 800M in its own unit and the existing 1 GB swap.]
3. **Keep Cloudflare as DNS + proxy + Tunnel, and Realtime TURN?** This is not compute, and it needs no open ports. [Default: yes. The alternative is Caddy on public 80/443 plus coturn, which first needs a check that k3s ServiceLB does not hold those ports.]
4. **Rollback policy:** rollback only within T+2h with manual re-entry of Rust-era bookings, fix-forward after that? [Default: yes.]
5. **Uploads and backups:** local disk on the VPS plus `VACUUM INTO`/uploads backups to which S3 target? [Default: the existing rustfs/S3 bucket from `deploy/backup.sh`.]
6. **MoMo/ZaloPay/VNPay stay off at launch?** [Default: yes; WP-P later.]
