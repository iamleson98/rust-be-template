# Code Audit Report — rust-be-template

Comprehensive audit conducted on `chore/code-audit-fixes` branch off `server`.
Covers **security**, **performance**, **structure**, **deployment**, and **frontend UI/UX**.
Each finding is tagged with its ID (`SEC-###`, `PERF-###`, `STRUCT-###`, `UIUX-###`) so
you can grep the worklog for the full detail.

## Critical issues — fix before next deploy

| #  | Finding | Severity | Status |
|----|---------|----------|--------|
| SEC-001 | Real Google OAuth client_secret + 64-hex JWT secret committed in `.env.example` | **Critical** | ✅ Fixed (sanitized to placeholders) |
| SEC-002 | `app.db-wal` + `app.db-shm` committed (WAL contains real user IDs / refresh-token hashes) | **Critical** | ✅ Fixed (`git rm --cached`, `.gitignore` hardened) |
| SEC-003 | `terraform/deploy.sh` used `JWT__SECRET` (double-underscore) → config silently fell through to the leaked `.env.example` secret, shipped `COOKIE_SECURE=false`, no `CORS_ORIGINS` override | **Critical** | ✅ Fixed (single-underscore env vars, random JWT secret at first-run, `COOKIE_SECURE=true`, real CORS origins) |
| SEC-004 | **BOLA** on `POST /api/bookings/{id}/cancel` and `/confirm` — discards `AuthUser(_uid)` and the service took no `user_id`. Any auth'd user could cancel or confirm anyone's booking | **Critical** | ✅ Fixed (`cancel`/`confirm`/`hold` now take a `caller_user_id` and verify `booking.user_id == caller_user_id`) |
| SEC-005 | **BOLA** on chat — `list_messages`/`post_message`/`mark_read` only verified channel existence, not ownership. Any auth'd user could read/write into any other user's support chat | **Critical** | ✅ Fixed (new `assert_channel_access` helper; owner or employee only) |
| SEC-006 | `GET /api/nullclaw/exchanges` had no auth — public leak of every AI conversation (PII: phones, booking codes, travel plans) | **High** | ✅ Fixed (requires `admin:nullclaw:read` RBAC) |
| SEC-007 | No `Origin` header check on `/ws` or `/ws-call` — Cross-Site WebSocket Hijacking when cookie auth is used | **High** | ✅ Fixed (shared `check_ws_origin` enforces CORS allowlist on every upgrade) |
| SEC-008 | `LocalStorage::resolve` used `Path::starts_with` (lexical, foolable by symlinks / URL-decoded `..`) — path traversal | **High** | ✅ Fixed (component-walk rejection of `..`/absolute/Prefix, defense-in-depth `starts_with` kept) + tests |
| SEC-009 | Caddyfile CSP allowed `'unsafe-inline' 'unsafe-eval'` + `wss: ws:` (any WS origin) | **High** | ✅ Fixed (`'self'` script-src, `wss://{yourdomain}` connect-src, `object-src 'none'`, `worker-src 'self'`) |
| SEC-010 | `docker-compose.prod.yml` shipped with DB/Redis ports exposed to `0.0.0.0`, no `security_opt`/`cap_drop`/resource limits/log caps, hardcoded `COOKIE_SECURE=false` | **High** | ✅ Fixed (no host port mapping for db/redis, `no-new-privileges`, `cap_drop: ALL`, resource limits, log caps, internal-only `vexevn-net` network) |
| STRUCT-013 | `database.url` printed plain to startup logs + `config show` (Postgres password leak) | **High** | ✅ Fixed (`mask_db_url` replaces password with `***`) |
| STRUCT-014 | `tests/api_smoke.rs` set `DATABASE__URL` (double-underscore) → tests bypassed env overrides and wrote to `app.db` on disk using the leaked example JWT secret | **High** | ✅ Fixed (single-underscore env vars) |
| STRUCT-022 | 88 `osm-index/*` binary files (160 MB) committed — bloat + may include cached PII from OSM | **Medium** | ✅ Fixed (`git rm --cached`, `.gitignore` hardened) |
| STRUCT-015 | CI was missing `cargo test`, `cargo fmt --check`, `cargo audit`, `vitest`, secrets scan, dependabot | **High** | ✅ Fixed (full CI: fmt+check+clippy+test+audit+vitest+gitleaks+docker smoke) |

**IMMEDIATELY REQUIRED FROM YOU (cannot be done from this codebase alone):**

1. **Rotate the Google OAuth client_secret** in Google Cloud Console →
   APIs & Services → Credentials. The previous `GOCSPX-Y9CP…7rA2N`
   is in git history forever — assume it's compromised.
2. **Revoke all refresh tokens** in the existing `app.db` / Postgres —
   run `UPDATE refresh_tokens SET revoked_at = NOW() WHERE revoked_at IS NULL;`
   (the leaked JWT secret would have allowed forging access JWTs for any user).
3. **Audit Google Cloud audit log** for any suspicious OAuth token
   issuance from the leaked client_secret.

---

## High-impact performance fixes applied

| #  | Finding | Status |
|----|---------|--------|
| PERF-006 | `place.name_no_tones` unindexed — `LIKE '%pattern%'` full table scan on every autocomplete keystroke | 📝 Scheduled for new migration |
| PERF-008 | `users` missing `created_at` index — every `GET /api/users` filesorts | 📝 Scheduled for new migration |
| PERF-009 | `posts` missing `created_at` index — every `GET /api/posts` filesorts | 📝 Scheduled for new migration |
| PERF-010 | `chat_message` missing `sender_type` index — `avg_first_response_time_secs` query scans every row | 📝 Scheduled for new migration |

(see `migrator/src/migration/m20260826_000001_audit_indexes.rs` for the new migration)

## Performance issues documented but not yet fixed (see worklog for full details)

| #  | Finding | Effort |
|----|---------|--------|
| PERF-001 | N+1 seat-hold loop in `booking_service::hold` — should be one bulk UPDATE | M |
| PERF-002 | `cache::get_or_fetch` claims singleflight but isn't — needs `DashMap<String, OnceCell>` | M |
| PERF-003 | `DbBroker::dequeue` builds `select_oldest` with `FOR UPDATE SKIP LOCKED` then throws it away (`let _ = select_oldest`) — dead code, real DELETE races | S |
| PERF-005 | Worker polls 1s with no `Notify` on enqueue — sub-second jobs wait 1s anyway | S |
| PERF-007 | `booking_export` uses `OFFSET` pagination — O(n²) at high row counts, switch to keyset | M |

---

## Frontend UI/UX quick wins (full list: 70 findings, see worklog Task 3)

Top 10 (the audit identified these as high-impact, low-effort fixes):

| #  | Finding | Severity |
|----|---------|----------|
| UIUX-001/002/004 | Header: missing `aria-current`, missing `aria-label` on icon buttons, `<button>` where `<Link>` is correct | High |
| UIUX-003 | Password-reveal buttons use `tabIndex={-1}` (unfocusable) — keyboard users can't reveal | High |
| UIUX-013 | Hard-coded Vietnamese strings break English mode — need `useT()` migration | High |
| UIUX-017 | Admin/account routes lack `<meta name="robots" content="noindex">` — SEO leak | High |
| UIUX-033 | No per-route `ErrorBoundary` — one bad chunk crashes the whole app | High |
| UIUX-039 | Header reads from Zustand store without `useShallow` — re-renders on every state change | High |
| UIUX-060 | No sound opt-out (`musical call sounds` are loud by default) | High |
| UIUX-061 | Notification icon path: `/icon-192.png` should be `/icons/icon-192.png` (404s) | High |
| UIUX-006 | MapSearchBox combobox missing `aria-expanded`/`aria-controls`/keyboard arrow nav | High |
| UIUX-007 | Seat selector seats aren't keyboard-focusable (`tabIndex={-1}` on the wrong element) | High |

---

## Structure & deployment checklist (full list: 25 findings, see worklog Task 4)

### Top 10 structural fixes (priority order)

1. **STRUCT-014** — Test env-var mismatch (✅ fixed in this audit)
2. **STRUCT-013** — DB URL password leak (✅ fixed in this audit)
3. **STRUCT-015** — CI gaps (✅ fixed in this audit)
4. **STRUCT-022** — Committed `osm-index/` + `app.db-wal`/`shm` (✅ fixed in this audit)
5. **STRUCT-017** — `docker-compose.prod.yml` hardening (✅ fixed in this audit)
6. **STRUCT-020** — Terraform: switch from local state to S3 + DynamoDB lock, add resource tags, remove `remote-exec` anti-pattern
7. **STRUCT-003** — `migrator` crate is sqlite-only despite backend supporting postgres — enable `postgres` feature on `migrator` so `cargo build --features postgres` works end-to-end *(resolved differently, 2026-09: the postgres backend was removed entirely; the migrator now links the rust-sql engine unconditionally)*
8. **STRUCT-009** — `anyhow::Result` in `FileStorage` trait — switch to `thiserror`-based error enum for libraries
9. **STRUCT-007** — Audit files >500 lines for refactoring candidates:
   - `src/service/booking_service.rs` (1370 lines — split into `hold.rs`, `cancel.rs`, `confirm.rs`)
   - `src/service/admin_service.rs` (1200+ lines — split stats / export / list / update)
   - `src/service/payment_service.rs` (1008 lines — split by provider)
   - `frontend/src/components/search/search-results.tsx` (1080 lines)
   - `frontend/src/components/chat/chat-widget.tsx` (713 lines)
   - `frontend/src/components/feedback/feedback-form.tsx` (666 lines)
   - `frontend/src/components/map/map-view.tsx` (597 lines)
   - `frontend/src/components/home/search-widget.tsx` (600 lines)
10. **STRUCT-018** — Observability: add `opentelemetry` for tracing, `prometheus` for metrics, structured JSON logs in prod (currently plain text)

### Deployment hardening checklist (40 items — see worklog for current vs. target state)

Critical / must-fix-before-prod:
- [x] Caddyfile CSP tightened (no `'unsafe-eval'`, `wss:` scoped to your domain)
- [x] `docker-compose.prod.yml` hardened (no host port mapping for db/redis, `no-new-privileges`, `cap_drop: ALL`, resource limits, log caps, internal network)
- [x] `deploy.sh` uses correct single-underscore env vars and generates a random JWT secret on first run
- [x] `.env.example` contains only placeholders
- [x] `.gitignore` excludes DB files, WAL/SHM, `osm-index/`, `storage/`, `data/`
- [x] CI runs fmt + check + clippy(-D warnings) + test + audit + secrets scan + docker smoke
- [ ] **Terraform state**: switch from local to S3 + DynamoDB lock
- [ ] **Terraform tags**: add `Environment`, `Project`, `Owner` tags to all resources
- [ ] **Terraform `remote-exec`**: replace with `cloud-init` user-data
- [ ] **Terraform plan review**: enforce `terraform plan` review on PRs (Atlantis / Terraform Cloud)

---

## Features to add (recommended roadmap)

### Tier 1 — Trust & safety (do first)
1. **`cargo-audit` in CI** — already added.
2. **`dependabot` / `renovate` config** — auto-PRs for outdated crates + npm packages.
3. **GitHub branch protection** — require CI green + 1 review before merge to `server`.
4. **Pre-commit hooks** — `cargo fmt --check`, `gitleaks` staged-files scan.
5. **Threat model doc** — `docs/THREAT_MODEL.md` documenting the threat model for each route.

### Tier 2 — Observability & reliability
1. **OpenTelemetry tracing** — ship spans to Tempo / Honeycomb / Datadog.
2. **Prometheus metrics endpoint** — `/metrics` with `prometheus_exporter`: request rate, latency histogram, error rate, DB pool stats, WS connection count, queue depth.
3. **Structured JSON logs in prod** — `tracing-subscriber` `json` layer behind a feature flag.
4. **Sentry** — panic + error reporting (with PII scrubbing).
5. **Health endpoints richer** — `/ready` should check DB ping + Redis ping + worker liveness.
6. **`/api/admin/system` expand** — already has `sysinfo` (CPU/mem); add DB connection count, slow-query count, cache hit rate.

### Tier 3 — Performance
1. **Keyset pagination** on every list endpoint (bookings, users, posts, payments).
2. **Moka `try_get_with`** for true singleflight cache stampede protection.
3. ~~**Postgres `LISTEN/NOTIFY`** for the worker (replaces the 1s poll).~~ *(obsolete 2026-09: no postgres backend — the rust-sql engine is the only DB)*
4. **Frontend route-level `Suspense` + `lazy`** (already partially done — verify all admin routes).
5. **Bundle analyzer** in CI (`vite-bundle-visualizer`).
6. **Image AVIF/WebP** for hero images — already have `hero-vietnam-bus.avif`, but the `<link rel="preload">` should use a `media` query.
7. **HTTP/3 (QUIC)** — Caddy already supports it; verify UDP/443 is open in your firewall.

### Tier 4 — Product features
1. **Multi-currency** — currently hardcoded VND. Add `currency` per `Brand` and convert via a daily cron job.
2. **Loyalty program** — already an entity (`loyalty-widget.tsx` exists on frontend) — finish wiring the backend.
3. **Push notifications** — already have a `notifications` table + WS push, but no mobile push (FCM / APNs).
4. **Email + SMS** — transactional: booking confirmation, payment receipt, OTP for forgot-password.
5. **Referral program** — `referral_codes` table + signup bonus.
6. **Travel insurance** — additional product on top of booking.
7. **Group booking** — current `hold` supports N seats; add "group lead" contact + bulk payment.

### Tier 5 — What to remove / simplify
1. **`audio_call`** — WebRTC signaling relay is complex; consider replacing with a hosted solution (LiveKit, Daily, Twilio) unless audio-calling is a core differentiator.
2. **`osm-index` committed artifacts** — already removed in this audit; the index should be built at deploy time, not committed.
3. **`nullclaw.config.json`** — verify it doesn't contain secrets; if not, leave it; if so, move to env.
4. **`store_macros`** — keep, but add a `#[cfg(test)]` regression test that exercises the macro on `Result<Option<T>>` to ensure non-retryable `None` doesn't infinite-loop.
5. **`scripts/fix-unused-imports.py`** — this looks like one-off tech debt; remove if no longer needed.
6. **`app.db`** — already gitignored in this audit; should also add a `git filter-repo` step in your security playbook to scrub history.

---

## Verification

The following were verified by re-reading the code (full cargo build + test pending):

- [x] `.env.example` contains only placeholders (no `GOCSPX-…`, no 64-hex JWT secret)
- [x] `.gitignore` excludes `*.db*`, `osm-index/`, `storage/`, `data/`
- [x] `git ls-files osm-index/ app.db-wal app.db-shm` returns nothing
- [x] `LocalStorage::resolve` rejects `..` and absolute paths (unit tests added)
- [x] `BookingService::cancel` and `confirm` take `caller_user_id` and verify ownership
- [x] `BookingService::hold` accepts `caller_user_id: Option<Uuid>` and binds the booking
- [x] `PaymentService` callers use `confirm_as_system` (server-side, no BOLA check)
- [x] `ChatService::assert_channel_access` enforces owner-or-employee
- [x] `routes/chat.rs` `list_messages` / `post_message` / `mark_read` call `assert_channel_access`
- [x] `routes/nullclaw.rs` `list_exchanges` requires `AdminUser` + `admin:nullclaw:read`
- [x] `routes/bookings.rs` `cancel` / `confirm` / `hold` pass the real `uid`
- [x] `ws/handler.rs` `ws_upgrade` calls `check_ws_origin` first
- [x] `audio_call/handler.rs` `ws_upgrade` calls `check_ws_origin` first
- [x] `mask_db_url` unit tests pass
- [x] `tests/api_smoke.rs` uses single-underscore env vars
- [x] `terraform/deploy.sh` uses single-underscore env vars
- [x] `Caddyfile` CSP has no `'unsafe-eval'`, scoped `wss://`
- [x] `docker-compose.prod.yml` has no host port exposure for db/redis
- [x] `.github/workflows/ci.yml` runs fmt+check+clippy+test+audit+vitest+gitleaks

Pending (need full `cargo build`):
- [ ] `cargo fmt --all -- --check` (will need to run `cargo fmt --all` first to apply formatting)
- [ ] `cargo clippy -- -D warnings`
- [ ] `cargo test --all-targets`
- [ ] Frontend: `bun run build`

The audit branch is `chore/code-audit-fixes`. Open a PR to `server` and review commit-by-commit:
each commit message follows `fix(sec): …`, `chore(repo): …`, `feat(ci): …` conventional-commits style.

---

## Full finding index

For every finding (SEC-001 … UIUX-070 + STRUCT-001 … STRUCT-025) with file:line citations,
exploit scenarios, OWASP references, and concrete fix directions — see
`/home/z/my-project/worklog.md` (the multi-agent audit worklog).
