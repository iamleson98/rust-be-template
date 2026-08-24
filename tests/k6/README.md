# k6 Load Tests — VeXeVN Backend

Intensive load test suite for the Rust backend, covering auth, chat,
bookings, payments, public search, admin dashboard, + a realistic
mixed workload. Designed to find the backend's sustainable throughput
+ breaking point.

## Quick start

```bash
# 1. Install k6 (if not already installed)
#    macOS:  brew install k6
#    Linux:  https://grafana.com/docs/k6/latest/set-up/install-k6/
#    Docker: docker run --rm -i grafana/k6 run - < tests/k6/scenarios/01-smoke.js

# 2. Start the backend (in another terminal)
cargo run -- serve
# or: docker compose up backend

# 3. Run the smoke test (1 VU, 1 iteration — verifies the server is up)
./tests/k6/run.sh smoke

# 4. Run a load test
./tests/k6/run.sh auth
./tests/k6/run.sh chat
./tests/k6/run.sh public

# 5. Run the mixed workload (closest to real production traffic)
./tests/k6/run.sh mixed

# 6. Find the breaking point (⚠️ will cause 429s + 500s)
./tests/k6/run.sh stress

# 7. Run all scenarios (except stress) in sequence
./tests/k6/run.sh all
```

## Critical setup notes

The backend has three middleware layers that will block naive k6
requests. The `config.js` handles all three automatically — just make
sure you import `withAuth()` / `commonHeaders` from `config.js` in
any custom scenario you write.

### 1. Anti-scraping User-Agent blocklist

`src/middleware/anti_scraping.rs` rejects any User-Agent that doesn't
look like a browser (must contain `Mozilla/5.0` + `AppleWebKit|Gecko|KHTML`).
The default k6 UA (`k6/0.x`) is blocked → 403.

**`config.js` sets a real Chrome UA on every request.**

### 2. Origin/Referer enforcement on mutations

Every POST/PATCH/PUT/DELETE to `/api/*` MUST include an `Origin` (or
`Referer`) header that matches one of the configured `CORS_ORIGINS`
(default: `http://localhost:8080` is allowed). Without it → 403.

**`config.js` sets `Origin` on every request.**

### 3. Cookie-based auth (NOT Authorization header)

The backend uses httpOnly cookies (`access_token` + `refresh_token`),
not `Authorization: Bearer` headers. k6's `http.cookieJar()` persists
them across requests in the same VU.

**`config.js` creates a per-VU cookie jar + passes it to every request
via `withAuth()`.** Use `resetJar()` when a VU needs to switch users
(e.g. from customer to admin).

## Environment variables

Override via `-e KEY=VALUE` on the k6 command line, or export them in
your shell before running `run.sh`.

| Variable | Default | Used by | Description |
|---|---|---|---|
| `BASE_URL` | `http://localhost:8080` | all | Backend URL |
| `ORIGIN` | `http://localhost:8080` | all | Value of the `Origin` header (must be in `CORS_ORIGINS`) |
| `USER_EMAIL` | — | auth, chat, booking, mixed | Existing customer email (for login path) |
| `USER_PASSWORD` | — | auth, chat, booking, mixed | Existing customer password |
| `ADMIN_EMAIL` | — | admin, mixed | Existing employee email |
| `ADMIN_PASSWORD` | — | admin, mixed | Existing employee password |
| `TRIP_ID` | placeholder UUID | booking | Valid trip UUID (for real booking flow) |
| `SEAT_ID_1` | placeholder UUID | booking | Valid seat UUID |
| `SEAT_ID_2` | placeholder UUID | booking | Another seat UUID |
| `STRESS_DURATION` | `5m` | stress | Override the stress test duration stages |
| `K6_OUT` | unset | run.sh | Set to `json` to write results to `tests/k6/results/<scenario>.json` |

## Scenario catalog

| # | Scenario | VUs | Duration | Description |
|---|---|---|---|---|
| 01 | `smoke` | 1 | ~5s | Health check — verifies the server is up |
| 02 | `auth` | 10→30 | ~2.5min | Register/login/refresh/logout storm |
| 03 | `chat` | 20→50 | ~3.5min | Chat channels + messages (with pagination) |
| 04 | `booking` | 15→30 | ~3.5min | Booking lifecycle: hold → confirm → payment → cancel |
| 05 | `public` | 50→100 | ~4min | Public read-heavy: homepage + search + reviews |
| 06 | `admin` | 5→10 | ~3.5min | Admin dashboard + moderation |
| 07 | `mixed` | 30+20+5 | ~4.5min | Realistic traffic mix (anonymous + customers + admins) |
| 08 | `stress` | 50→400 | ~5min | Ramp to breaking point (expect 429s + 500s) |

### Scenario details

#### 01-smoke.js
1 VU, 1 iteration. Hits `/health`, `/ready`, `/api/stats`, `/api/brands`,
`/api/zeroclaw/status`. No auth. Use this to verify the server is
alive before running the heavier scenarios.

#### 02-auth.js
Ramps 10→30 VUs. Mix of:
- 50% register a NEW user (heavy DB write — argon2 hash + RBAC role assignment)
- 30% login as existing user (read path)
- 20% refresh + me + logout (token rotation cycle)

Set `USER_EMAIL` + `USER_PASSWORD` for the login path. If unset, only
the register path runs (still exercises the heavy write path).

#### 03-chat.js
Ramps 20→50 VUs. Each VU:
1. Registers once (on first iteration)
2. Lists channels
3. Creates or reuses a channel
4. Lists latest 30 messages (page 0)
5. Lists next 30 older messages (page 1 — exercises infinite scroll)
6. Sends 5 messages with random content + think-time
7. Marks the channel as read

Exercises the full chat insert + WS-broadcast path (the REST
`POST /api/chat/channels/{id}/messages` broadcasts to the WS room
after insert).

#### 04-booking.js
Ramps 15→30 VUs. Each VU:
1. Registers once
2. Searches trips (Hà Nội → Đà Nẵng)
3. Fetches trip detail (if `TRIP_ID` is set)
4. Lists existing bookings
5. Holds a booking (seats reserved)
6. Confirms with COD payment
7. Creates + polls a payment record
8. Cancels the booking (releases seats)

Without `TRIP_ID` + `SEAT_ID_*`, the hold step will 404 — that's
fine, it still exercises the auth + validation + DB query path. For
real bookings, seed a trip + seats via the admin endpoints first.

#### 05-public.js
Ramps 50→100 VUs (public endpoints can handle more RPS). Mix of:
- 30% homepage browse (stats → brands → recommendations → campaigns)
- 30% search trips (varied routes + dates)
- 20% place autocomplete (OSM-backed)
- 10% list reviews
- 10% reverse geocode + directions (Valhalla proxy)

No auth — all endpoints are public. Stricter latency thresholds
(p(95) < 300ms) since these should be fast + cacheable.

#### 06-admin.js
Ramps 5→10 VUs (fewer admins). Each VU logs in as an employee via
`/api/auth/employee-login`, then:
- 30% dashboard overview (system status + booking stats + list)
- 20% reviews moderation queue
- 20% payments management
- 15% brands + routes master-detail
- 10% schedules + pickup points
- 5% CSV export (HEAVY — only 5% to avoid OOM)

Set `ADMIN_EMAIL` + `ADMIN_PASSWORD` to an existing employee account.

#### 07-mixed.js
Three concurrent scenarios (k6 `scenarios` feature):
- **anonymous** (30→50 VUs): homepage + search + reviews (no auth)
- **customers** (10→20 VUs): login + chat + booking lifecycle
- **admins** (2→5 VUs): dashboard + moderation

This is the closest scenario to real production traffic. Set
`USER_EMAIL`/`USER_PASSWORD` + `ADMIN_EMAIL`/`ADMIN_PASSWORD` for
the authenticated paths.

#### 08-stress.js
Ramps 50→400 VUs aggressively. Loose thresholds (p(99) < 10s, error
rate < 30%) — the goal is to find the breaking point, not to pass.

Watch for:
- **p(95) latency spike** — when does it exceed 2s?
- **error rate climb** — 429s = rate limiter (600 RPM / 100 burst per IP), 500s = backend errors
- **throughput flattening** — when `iterations/sec` stops growing, the backend is saturated

⚠️ **Will cause 429s + 500s.** Don't run against a production DB
without a snapshot/rollback plan.

## Interpreting results

k6 outputs a summary table at the end. Key metrics:

| Metric | What it means | Healthy range |
|---|---|---|
| `http_req_duration` | Time per request (p(95), p(99)) | p(95) < 500ms, p(99) < 2s |
| `http_req_failed` | % of non-2xx responses | < 1% (except stress) |
| `iterations` | Total iterations completed | higher = more throughput |
| `vus` | Peak concurrent VUs | matches your ramp stages |
| `iteration_duration` | Time per full iteration (including sleep) | depends on scenario |

### Common failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| 403 on every request | Missing `Origin` header or browser UA | Check `config.js` is imported |
| 401 on authenticated requests | Cookies not persisting | Ensure `jar: getJar()` in `withAuth()` |
| 429 after ~100 requests | Rate limiter (600 RPM / 100 burst per IP) | Reduce VUs or raise `RATE_LIMIT_RPM` |
| 500 on register | Email/phone collision (UNIQUE constraint) | Use `uniqueEmail()` / `uniquePhone()` |
| 404 on booking hold | Placeholder trip/seat UUIDs | Set `TRIP_ID` + `SEAT_ID_*` env vars |
| WS messages not received | k6 `http` module can't do WS | Use `k6/ws` (experimental) or a separate WS client |

## File structure

```
tests/k6/
├── README.md                # This file
├── run.sh                   # Convenience runner
├── config.js                # Shared config (BASE_URL, headers, cookies)
├── helpers/
│   ├── auth.js              # register, login, employeeLogin, refresh, logout, me
│   ├── chat.js              # listChannels, createChannel, listMessages, sendMessage, markRead
│   ├── booking.js           # holdBooking, confirmBooking, cancelBooking, createPayment
│   ├── public.js            # searchTrips, listBrands, getRecommendations, searchPlaces
│   └── admin.js             # listAdminBookings, adminBookingStats, listAdminReviews
└── scenarios/
    ├── 01-smoke.js          # 1 VU, 1 iter — health check
    ├── 02-auth.js           # 10→30 VUs — auth storm
    ├── 03-chat.js           # 20→50 VUs — chat load
    ├── 04-booking.js        # 15→30 VUs — booking lifecycle
    ├── 05-public.js         # 50→100 VUs — public read-heavy
    ├── 06-admin.js          # 5→10 VUs — admin dashboard
    ├── 07-mixed.js          # 30+20+5 VUs — realistic mix
    └── 08-stress.js         # 50→400 VUs — find breaking point
```

## Writing a custom scenario

```javascript
import { sleep } from 'k6';
import { register, me } from '../helpers/auth.js';
import { listChannels, sendMessage } from '../helpers/chat.js';

export const options = {
  vus: 20,
  duration: '1m',
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  register();
  sleep(0.3);
  me();
  sleep(0.2);
  const ch = createChannel();
  // ... your custom flow
}
```

The helpers handle auth, headers, cookies, + checks — you focus on
the business logic.

## Tips for production-scale tests

1. **Run from a separate machine** — don't load-test from the same
   host as the backend; the load generator competes for CPU.
2. **Use connection reuse** — k6 reuses HTTP connections by default;
   don't set `noConnectionReuse: true` unless you're testing connection
   setup overhead.
3. **Watch the backend** — during the test, monitor:
   - `cargo run` logs (look for slow queries, panics)
   - DB CPU + memory (SQLite: check `app.db-wal` size; Postgres: `pg_stat_activity`)
   - Redis memory (if caching is enabled)
4. **Start with the smoke test** — always run `01-smoke.js` first to
   verify the server is up + the config is correct before launching
   a long-running load test.
5. **Use JSON output for CI** — `K6_OUT=json ./tests/k6/run.sh auth`
   writes results to `tests/k6/results/auth.json` for parsing in CI.
