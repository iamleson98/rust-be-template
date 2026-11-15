# Parity of the Rust service with the Cloudflare reference

The Rust service replaces the Worker, so it has to answer the way the Worker answers, on the
same data. This is the harness that checks that, and the result of its last run.

- `scripts/parity/` starts both systems on **one** stage database and compares them.
- `scripts/parity/ref-scripts.sh` runs the Worker's own integration scripts against Rust.
- `frontend/e2e-smoke/` drives the built SPA against Rust with Playwright.

Everything runs locally. Nothing touches a Cloudflare account: the reference runs as
`next dev` on wrangler's local (miniflare) D1, with remote bindings off.

## Running it

```sh
export PARITY_WORK=/tmp/datxevui-parity            # stage db, imported db, REF copy, logs
export CARGO_TARGET_DIR=~/.cache/datxevui-target CARGO_INCREMENTAL=0 CARGO_PROFILE_DEV_DEBUG=0
cargo build --bin backend -p place-extract         # the server and the place extractor
(cd frontend && bun install && bun run build)      # frontend/dist, served by Rust
export RUST_BIN=$CARGO_TARGET_DIR/debug/backend PLACE_EXTRACT_BIN=$CARGO_TARGET_DIR/debug/place-extract

scripts/parity/stage.sh                            # migrations 0000-0009 + seed_cf.sql + synthetic.sql
scripts/parity/build-places.sh                     # tiny OSM extract -> both place indexes
scripts/parity/up.sh                               # REF on :3001, import + Rust on :3102
node scripts/parity/run.mjs --stage $PARITY_WORK/stage.db --out $PARITY_WORK/out
scripts/parity/ref-scripts.sh                      # the Worker's scripts, fresh Rust on :3000
(cd frontend && bunx playwright install chromium && \
  bunx playwright test -c playwright.smoke.config.ts)
scripts/parity/down.sh
```

`run.mjs --doc docs/PARITY.md` rewrites the request table at the bottom of this file; the
difference behind every non-identical row (REF value, Rust value, the rule that classified it)
is in `<out>/report.md` and `<out>/results.json`. The REF
copy needs about 1.1 GB of `node_modules` (`rm -rf $PARITY_WORK/ref` when finished).

## How the comparison works

- **One input.** `stage.sh` builds the stage database once (the synthetic rows' dates are
  relative to the day it runs). The REF's local D1 file *is* a copy of it; Rust gets
  `backend import-d1` of the same file. Two columns of the fixture are hand-set and disagree
  with the rows they summarise (`brand.rating`, `trip_session.available_seats`); `stage.sh`
  settles them first, as the importer does, so a difference is code and not data.
- **Requests.** About 270 GETs from `cases.mjs`: city search (matching, dates, errors, every
  filter, facets, sort, paging, `minSeats`, `departAfter`), coordinate search (with and without
  `fromCity`+`toCity`, `maxDistanceKm`, filters, sort, errors), places (popular, search, reverse),
  brands and brand profiles, routes and pictures, recommendations, stats, reviews and stats, trip
  detail (every opened trip), campaigns, posts, providers, SEO files, then the signed-in
  customer's lists and the admin lists. This covers the cases WP3 did not port from the REF's
  `trip-search`, `trip-results` and `trip-search-options` tests.
- **Normalised.** Timestamps with an offset become one instant. Trip ids and seat ids, which each
  server makes up when it opens a trip, become `trip[<schedule>@<date>]` and
  `seat[<trip>:<label>]`. `null` and an absent key are the same. `serverTime`, `time`, `score`
  are dropped. Arrays of keyed items are matched by key, and *order* is reported separately.
- **Classified** by `rules.mjs`: a rule is written only once the cause is known, and carries its
  reason. A difference no rule matches is an unclassified BUG; a rule of class `BUG` attributes
  it to a numbered defect below.
- **Places** are compared by response shape and by the best hit only: the REF has no local
  index of its own (its real engine is a remote VPS binding), so it answers from its static
  shard fallback, built from the same extract as Rust's index.

The place index comes from a hand-made OSM extract (`make-osm-pbf.mjs`: the 63 city-list
provinces as square boundaries, their seats, bus stations, airports, 15 000 numbered hamlets).
`places-build` refuses a download under 100 MiB, fewer than 15 000 places, or places outside a
served province, so the extract is padded and shaped to pass those guards: it is a fixture, not
a survey.

## Result of the last run

272 requests: **120 identical, 110 explained, 42 BUG** (the 42 are six defects, below).

| Group | Identical | Explained | BUG |
|---|---|---|---|
| city search, filters, facets, sort, paging (`search`, `search-options`) | 30 | 48 | 6 |
| coordinate search (`geo`) | 29 | 2 | 0 |
| search and geo errors | 3 | 4 | 7 |
| trip detail | 11 | 5 | 0 |
| brands, profiles, routes, pictures, recommendations, stats | 22 | 10 | 2 |
| reviews | 6 | 1 | 18 |
| places | 1 | 15 | 4 |
| misc, SEO | 10 | 5 | 2 |
| signed-in customer, admin | 8 | 20 | 3 |

Every filter, the facets, the three sorts, paging, `minSeats`, `departAfter` and the coordinate
search with cities answer identically; what remains in those groups is the importer skipping a
schedule stop (below) and the error envelope.

### Explained differences

| Cause | Requests hit | What it is |
|---|---|---|
| import: skipped stop | 50 | the importer skips the one stop whose address has no coordinates (a synthetic row on purpose), so `arrivalAt` of that schedule rolls to the next day |
| place engines | 16 | REF answers from static shards (`engine: "static-shards"`, cached 60 s as degraded); Rust from its index (`"index"`, 300 s / 3600 s). Popular ties and the weaker `near` bias are the shards' |
| import: timestamps | 16 | REF returns the stored text, Rust one canonical instant; a literal `(datetime('now'))` becomes the import time (and re-orders notifications; a booking with such a date is counted in Rust's per-day stats, dropped by REF's) |
| error code | 10 | REF names every 400 `validation_error: "validation failed: ..."`, Rust `bad_request: "bad request: ..."`; the SPA reads only `message` and the status |
| cache headers | 9 | REF sends none where Rust sends a public cache (pictures, ads.txt) |
| import: orphan FK, stop kinds, days mask, skipped rows | 15 | `review.booking_id` of a missing booking is cleared; stop kinds map `departure/intermediate/destination` (from 1) to `pickup/middle/drop` (from 0); legacy JSON weekdays become the 7-char mask (REF shows `null` for them); address / route picture rows without coordinates or size are skipped |
| admin DTOs | 13 | Rust returns more or other fields (derived province, seat class tally, coupon owner and booking summary, system report); REF counts coupons `held` in `totals.inUse` although the status is `reserved`; Rust requires `routeId` / `brandId` on three lists (the SPA always sends it); REF-only `/api/admin/stats` (no screen calls it); the Rust migrator seeds shared preset layouts |
| other | 10 | tags stored as comma text (REF reads JSON only), a different QR encoder, `/api` 404 as JSON instead of Next's HTML, each server's own origin in `robots.txt` and return URLs, NullClaw off in the harness, a trailing newline |

`cities.json` is byte-identical between the REF and `frontend/src/lib`; `amenities.ts` and
`city-match.ts` differ only in formatting and comments. They are client code, not endpoints.

## Defects found

Rust defects only; nothing is fixed here. Each has REF evidence.

1. **VietQR is never offered** (`src/config/mod.rs:1143`). `PaymentConfig::default()` builds
   `VietQrConfig::default()` (derived: disabled, empty) instead of `VietQrConfig::from_env()`, so
   `VIETQR_ENABLED=true` and the bank settings are ignored. `GET /api/payments/providers` says
   `["cod"]` where REF says `["cod","vietqr"]`, and no booking carries `bankTransferInstructions`.
   Production sets `VIETQR_ENABLED=true`. **Blocks cutover.** (smoke step 4 fails)
2. **A signed-in user's price alerts are always empty** (`src/store/price_alert.rs:118`, `:155`,
   `:191`). `price_alert.user_id` is a TEXT column (the entity says `String`, `create` stores
   `u.to_string()`), but these filters compare it with a `Uuid`, which binds as a BLOB. The guest
   lookup by phone works; the owner's list and count never match, for imported rows and for rows
   created in Rust alike. REF returns the alert.
3. **Query, path and JSON rejections are plain text** (every handler that uses axum's `Query`,
   `Path` or `Json` extractor; no rejection mapping exists). A bad `limit`, a missing `from`, a
   non-UUID id answers `400 text/plain` ("Failed to deserialize query string: ...") and an empty
   JSON body `422 text/plain`, outside the `{error, message}` envelope. REF answers the same
   statuses with the envelope. The Worker's `contract-sweep` fails four checks on exactly this
   (`/api/admin/pickup-points?routeId=none`, `/api/admin/schedules?routeId=none`,
   `POST /api/admin/coupons/settle`, `POST /api/payments/ipn/momo`).
4. **Reverse geocoding out of range answers 400** (`src/routes/places.rs:46`); REF answers `200`
   with an empty list. Item 9 of the G1/G2 fix list asked to match REF.
5. **A missing permission answers `{"error":"store_error"}`** (`src/rbac/checker.rs:70` returns a
   `StoreError` that every `state.rbac.require(..)?` turns into `AppError::Store`, code
   `store_error`, message "store error: forbidden: ..."). The status is 403, the code is not
   `forbidden`. Seen on `GET /api/users` as a customer.
6. **`/api/reviews`, `/api/reviews/stats`, `/api/reviews/tags` have no cache header**
   (`src/routes/router.rs`: the reviews nest lacks the `public_cache` layer the other public reads
   have). REF sends `public, max-age=60`. Load, not correctness.
7. **Admin cannot save a brand with a 1900 hotline** (`src/dto/admin.rs:126`: `contact_phone`
   goes through `validate_phone`, which accepts only `+...` or a number starting with `0`). All
   four fixture brands (and the one on the public brand page) carry `1900xxxx`; the PUT answers
   400 "contact phone must be a valid phone number". REF accepts any text up to 32 characters.
   Not seen by the GET harness: smoke step 7 fails. **Blocks editing brands after cutover.**

Seen, not Rust defects: the fixture's `child_max_age = 40` is over the form's limit of 17, so
the form refuses to save such a brand until the age is lowered (real data should be checked
before cutover); the search card prints the raw key `blanket` as an amenity (the same in the
REF's SPA); the anti-scraping layer refuses Playwright's `HeadlessChrome` User-Agent, including
the service worker's script fetch (the smoke config sends a browser UA and blocks service
workers).

## The Worker's own scripts against Rust

`ref-scripts.sh`, on a fresh database whose first account is the admin:

| Script | Result |
|---|---|
| `contract-sweep` | 55 pass, 4 fail: defect 3 |
| `ws-smoke` | pass |
| `chat-flow` | pass |
| `call-hub` | pass |

The scripts' `fetch` is given a browser User-Agent and an Origin by `ref-scripts/browser-ua.mjs`
(`node --import`): the anti-scraping layer refuses node's own, by design. The same file replays
an already-fired socket `open`: `chat-flow` awaits two sockets in turn and, against a fast
server, waits for the second one's `open` forever (a race in the script, not in the server).

## Smoke (`frontend/e2e-smoke`)

The built SPA on the Rust server over the imported fixture, Chromium, one worker: 10 steps,
**8 pass, 2 fail** (defects 1 and 7).

| Step | Result |
|---|---|
| home, search, trip detail with its seat map | pass |
| sign in with the imported pbkdf2 account; a wrong password is refused | pass |
| seat hold, passenger, contact, cash-on-board checkout, pending ticket, ticket page | pass |
| VietQR offered and its bank details shown | **fail** (defect 1) |
| brand page | pass |
| admin edits a brand (hotline changed to a mobile number), public page shows it | pass |
| admin saves a brand that keeps its 1900 hotline | **fail** (defect 7) |
| admin uploads a route picture, stored and served as `image/webp` | pass |
| unknown address: 404 status and not-found page | pass |
| place search: suggestions and the map picker | pass |

The fixture's admin has no usable password, so the admin steps sign the `access_token` cookie
themselves with the server's `JWT_SECRET` (`SMOKE_JWT_SECRET`).

## Not covered

- The REF is `next dev`, not the production OpenNext build: the edge cache, the Cache API and the
  Worker's rate-limit bindings are not exercised (the local bindings enforce none; the Rust
  limits are lifted for the run).
- Only GETs are differential. Writes are covered by the smoke steps and the Worker's scripts.
- Place ranking against the REF's real engine (the VPS service). Payment gateways, push, the
  TURN call path, OAuth.
- A real production export: the fixture is small and synthetic; the dry run on real data is the
  importer's (WP10, WP14).

## Requests

<!-- PARITY-RESULTS:BEGIN -->
272 requests: 120 identical, 110 explained, 42 BUG.

Defects seen:

- BUG-3 query rejections are plain text: 21 request(s)
- BUG-6 no cache header on reviews: 14 request(s)
- BUG-4 reverse geocode out of range: 1 request(s)
- BUG-1 VIETQR_* never read: 2 request(s)
- BUG-2 price alerts of a user: 1 request(s)
- BUG-5 403 with code store_error: 1 request(s)

| # | case | REF | Rust | result |
|---|---|---|---|---|
| 1 | search: Hà Nội → Đà Nẵng, today+0 | 200 | 200 | identical |
| 2 | search: Hà Nội → Đà Nẵng, today+1 | 200 | 200 | explained |
| 3 | search: Hà Nội → Đà Nẵng, today+2 | 200 | 200 | explained |
| 4 | search: Hà Nội → Đà Nẵng, today+3 | 200 | 200 | explained |
| 5 | search: Hà Nội → Đà Nẵng, today+4 | 200 | 200 | explained |
| 6 | search: Hà Nội → Đà Nẵng, today+6 | 200 | 200 | identical |
| 7 | search: "ha noi" → "da nang" | 200 | 200 | explained |
| 8 | search: "HN" → "DN" | 200 | 200 | explained |
| 9 | search: "Hanoi" → "Danang" | 200 | 200 | explained |
| 10 | search: "  Hà Nội  " → "Đà Nẵng" | 200 | 200 | explained |
| 11 | search: "Đà Nẵng" → "Hà Nội" | 200 | 200 | identical |
| 12 | search: "Hà Nội" → "Sài Gòn" | 200 | 200 | identical |
| 13 | search: "Hà Nội" → "Sa Pa" | 200 | 200 | identical |
| 14 | search: "Hà Nội" → "Lào Cai" | 200 | 200 | identical |
| 15 | search: "TP. Hồ Chí Minh" → "Nha Trang" | 200 | 200 | identical |
| 16 | search: "Sài Gòn" → "Nha Trang" | 200 | 200 | identical |
| 17 | search: "hcm" → "đà lạt" | 200 | 200 | identical |
| 18 | search: "Huế" → "Vinh" | 200 | 200 | identical |
| 19 | search-errors: no from | 400 | 400 | BUG |
| 20 | search-errors: no to | 400 | 400 | BUG |
| 21 | search-errors: blank from | 400 | 400 | explained |
| 22 | search-errors: no date | 400 | 400 | BUG |
| 23 | search-errors: bad date | 400 | 400 | explained |
| 24 | search-errors: date format | 400 | 400 | explained |
| 25 | search-errors: past date | 200 | 200 | identical |
| 26 | search-errors: far future | 200 | 200 | identical |
| 27 | search-options: limit 1 | 200 | 200 | identical |
| 28 | search-options: limit 2 offset 1 | 200 | 200 | explained |
| 29 | search-options: limit 2 offset 2 | 200 | 200 | explained |
| 30 | search-options: offset past the end | 200 | 200 | identical |
| 31 | search-options: limit 0 clamps to 1 | 200 | 200 | identical |
| 32 | search-options: limit 1000 clamps to 100 | 200 | 200 | explained |
| 33 | search-options: limit abc | 400 | 400 | BUG |
| 34 | search-options: offset 1.5 | 400 | 400 | BUG |
| 35 | search-options: sort price | 200 | 200 | explained |
| 36 | search-options: sort rating | 200 | 200 | explained |
| 37 | search-options: sort departure | 200 | 200 | explained |
| 38 | search-options: sort distance is the default here | 200 | 200 | explained |
| 39 | search-options: sort bogus | 200 | 200 | explained |
| 40 | search-options: sort price paged | 200 | 200 | identical |
| 41 | search-options: minSeats 1 | 200 | 200 | explained |
| 42 | search-options: minSeats 4 | 200 | 200 | explained |
| 43 | search-options: minSeats 5 | 200 | 200 | explained |
| 44 | search-options: minSeats 17 | 200 | 200 | identical |
| 45 | search-options: minSeats 0 clamps to 1 | 200 | 200 | explained |
| 46 | search-options: minSeats x | 400 | 400 | BUG |
| 47 | search-options: vehicleTypes limousine | 200 | 200 | explained |
| 48 | search-options: vehicleTypes limousine, sleeper | 200 | 200 | explained |
| 49 | search-options: vehicleTypes unknown | 200 | 200 | identical |
| 50 | search-options: brands viet-bus | 200 | 200 | explained |
| 51 | search-options: brands viet-bus,phuong-trang | 200 | 200 | explained |
| 52 | search-options: brands blanks | 200 | 200 | explained |
| 53 | search-options: priceMin 300000 | 200 | 200 | identical |
| 54 | search-options: priceMax 300000 | 200 | 200 | explained |
| 55 | search-options: priceMin+Max band | 200 | 200 | explained |
| 56 | search-options: priceMax 0 is ignored | 200 | 200 | explained |
| 57 | search-options: priceMin 1.5 | 400 | 400 | BUG |
| 58 | search-options: hours 0-6 | 200 | 200 | identical |
| 59 | search-options: hours 6-12 | 200 | 200 | identical |
| 60 | search-options: hours 12-18,18-24 | 200 | 200 | explained |
| 61 | search-options: hours unknown band | 400 | 400 | explained |
| 62 | search-options: minRating 4.5 | 200 | 200 | identical |
| 63 | search-options: minRating 4.1 | 200 | 200 | explained |
| 64 | search-options: minRating 0 | 200 | 200 | explained |
| 65 | search-options: minRating high | 400 | 400 | BUG |
| 66 | search-options: plentyOfSeats true | 200 | 200 | explained |
| 67 | search-options: plentyOfSeats false | 200 | 200 | explained |
| 68 | search-options: plentyOfSeats yes | 400 | 400 | BUG |
| 69 | search-options: amenities wifi | 200 | 200 | explained |
| 70 | search-options: amenities wifi,blanket | 200 | 200 | identical |
| 71 | search-options: amenities snack | 200 | 200 | identical |
| 72 | search-options: amenities unknown | 200 | 200 | identical |
| 73 | search-options: departAfter 06:30 | 200 | 200 | explained |
| 74 | search-options: departAfter 08:00 | 200 | 200 | explained |
| 75 | search-options: departAfter 12:00 | 200 | 200 | explained |
| 76 | search-options: departAfter 23:59 | 200 | 200 | identical |
| 77 | search-options: departAfter blank | 400 | 400 | explained |
| 78 | search-options: departAfter 24:00 | 400 | 400 | explained |
| 79 | search-options: departAfter morning | 400 | 400 | explained |
| 80 | search-options: departAfter 06:30:00 | 400 | 400 | explained |
| 81 | search-options: filters combined | 200 | 200 | explained |
| 82 | search-options: filters + page | 200 | 200 | explained |
| 83 | search-options: HCM→Nha Trang price asc | 200 | 200 | identical |
| 84 | search-options: HCM→Nha Trang rating | 200 | 200 | identical |
| 85 | search-options: HCM→Nha Trang hours 18-24 | 200 | 200 | identical |
| 86 | search-options: HCM→Nha Trang minRating 4.3 | 200 | 200 | identical |
| 87 | search-options: HCM→Đà Lạt default | 200 | 200 | identical |
| 88 | search-options: Hà Nội→Sa Pa default | 200 | 200 | identical |
| 89 | search-options: Hà Nội→Đà Nẵng sort price, today+1 | 200 | 200 | explained |
| 90 | search-options: Hà Nội→Đà Nẵng sort price, today+2 | 200 | 200 | explained |
| 91 | search-options: Hà Nội→Đà Nẵng sort price, today+4 | 200 | 200 | explained |
| 92 | search-options: Hà Nội→Đà Nẵng sort price, today+5 | 200 | 200 | explained |
| 93 | geo: HN → ĐN default (distance) | 200 | 200 | identical |
| 94 | geo: HN → ĐN with fromCity+toCity | 200 | 200 | explained |
| 95 | geo: HN → ĐN cities only one given | 200 | 200 | identical |
| 96 | geo: HN → ĐN cities, reverse direction | 200 | 200 | identical |
| 97 | geo: HN → ĐN reverse coordinates | 200 | 200 | identical |
| 98 | geo: HCM → NT | 200 | 200 | identical |
| 99 | geo: HCM → NT with cities | 200 | 200 | identical |
| 100 | geo: HCM → ĐL with cities | 200 | 200 | identical |
| 101 | geo: HN → Sa Pa with cities | 200 | 200 | identical |
| 102 | geo: maxDistanceKm 1 | 200 | 200 | identical |
| 103 | geo: maxDistanceKm 5 | 200 | 200 | identical |
| 104 | geo: maxDistanceKm 500 (clamp) | 200 | 200 | identical |
| 105 | geo: maxDistanceKm 0 (clamp) | 200 | 200 | identical |
| 106 | geo: near a stop, not a city centre | 200 | 200 | identical |
| 107 | geo: sort price | 200 | 200 | identical |
| 108 | geo: sort rating | 200 | 200 | identical |
| 109 | geo: sort departure | 200 | 200 | identical |
| 110 | geo: sort bogus | 200 | 200 | identical |
| 111 | geo: minSeats 4 | 200 | 200 | identical |
| 112 | geo: minSeats 17 | 200 | 200 | identical |
| 113 | geo: departAfter 07:00 | 200 | 200 | identical |
| 114 | geo: departAfter 13:00 + cities | 200 | 200 | explained |
| 115 | geo: limit 1 | 200 | 200 | identical |
| 116 | geo: limit 1 offset 1 | 200 | 200 | identical |
| 117 | geo: filters (vehicle, price, amenities) | 200 | 200 | identical |
| 118 | geo: filters hours + brands | 200 | 200 | identical |
| 119 | geo: plentyOfSeats | 200 | 200 | identical |
| 120 | geo: minRating 4.3 | 200 | 200 | identical |
| 121 | geo: no results (sea) | 200 | 200 | identical |
| 122 | geo: date +1 | 200 | 200 | identical |
| 123 | geo: date +5 | 200 | 200 | identical |
| 124 | geo-errors: missing fromLat | 400 | 400 | BUG |
| 125 | geo-errors: missing toLon | 400 | 400 | BUG |
| 126 | geo-errors: fromLat NaN | 400 | 400 | BUG |
| 127 | geo-errors: latitude out of range | 200 | 200 | identical |
| 128 | geo-errors: bad date | 400 | 400 | explained |
| 129 | geo-errors: no date | 400 | 400 | BUG |
| 130 | catalog: recommendations | 200 | 200 | identical |
| 131 | catalog: stats | 200 | 200 | identical |
| 132 | catalog: brands | 200 | 200 | identical |
| 133 | catalog: brands limit 2 | 200 | 200 | identical |
| 134 | catalog: routes | 200 | 200 | identical |
| 135 | catalog: routes limit 3 offset 2 | 200 | 200 | identical |
| 136 | catalog: routes limit 0 | 200 | 200 | identical |
| 137 | catalog: routes limit abc | 400 | 400 | BUG |
| 138 | brand: brand hoang-long | 200 | 200 | identical |
| 139 | brand: profile hoang-long | 200 | 200 | identical |
| 140 | catalog: routes of hoang-long | 200 | 200 | identical |
| 141 | brand: brand phuong-trang | 200 | 200 | identical |
| 142 | brand: profile phuong-trang | 200 | 200 | identical |
| 143 | catalog: routes of phuong-trang | 200 | 200 | identical |
| 144 | brand: brand thanh-buoi | 200 | 200 | identical |
| 145 | brand: profile thanh-buoi | 200 | 200 | identical |
| 146 | catalog: routes of thanh-buoi | 200 | 200 | identical |
| 147 | brand: brand viet-bus | 200 | 200 | identical |
| 148 | brand: profile viet-bus | 200 | 200 | explained |
| 149 | catalog: routes of viet-bus | 200 | 200 | identical |
| 150 | brand: brand by id | 404 | 404 | identical |
| 151 | brand: unknown brand slug | 404 | 404 | identical |
| 152 | brand: unknown brand profile | 404 | 404 | identical |
| 153 | brand: brand slug uppercase | 404 | 404 | identical |
| 154 | catalog: routes bad brand_id | 400 | 400 | explained |
| 155 | pictures: route 5d691f13 | 200 | 200 | explained |
| 156 | pictures: route 5dee08f3 | 200 | 200 | explained |
| 157 | pictures: route 6a0b1761 | 200 | 200 | explained |
| 158 | pictures: route 6a564179 | 200 | 200 | explained |
| 159 | pictures: route 9f71af7b | 200 | 200 | explained |
| 160 | pictures: route f2d943ac | 200 | 200 | explained |
| 161 | pictures: route ff75817c | 200 | 200 | explained |
| 162 | pictures: bad id | 400 | 400 | BUG |
| 163 | pictures: unknown id | 200 | 200 | explained |
| 164 | reviews: list | 200 | 200 | BUG |
| 165 | reviews: limit 1 | 200 | 200 | BUG |
| 166 | reviews: limit 1 offset 1 | 200 | 200 | BUG |
| 167 | reviews: limit 1000 | 200 | 200 | BUG |
| 168 | reviews: limit abc | 400 | 400 | BUG |
| 169 | reviews: bad brand_id | 400 | 400 | identical |
| 170 | reviews: tags | 200 | 200 | identical |
| 171 | reviews: stats (all) | 400 | 400 | identical |
| 172 | reviews: list of hoang-long | 200 | 200 | BUG |
| 173 | reviews: stats of hoang-long | 200 | 200 | BUG |
| 174 | reviews: list of phuong-trang | 200 | 200 | BUG |
| 175 | reviews: stats of phuong-trang | 200 | 200 | BUG |
| 176 | reviews: list of thanh-buoi | 200 | 200 | BUG |
| 177 | reviews: stats of thanh-buoi | 200 | 200 | BUG |
| 178 | reviews: list of viet-bus | 200 | 200 | BUG |
| 179 | reviews: stats of viet-bus | 200 | 200 | BUG |
| 180 | reviews: list route 6a0b1761 | 200 | 200 | BUG |
| 181 | reviews: stats route 6a0b1761 | 200 | 200 | BUG |
| 182 | reviews: review 8643b2d6 | 200 | 200 | identical |
| 183 | reviews: list route  | 400 | 400 | identical |
| 184 | reviews: stats route  | 400 | 400 | BUG |
| 185 | reviews: review c42a1a4d | 404 | 404 | identical |
| 186 | reviews: list route 6a0b1761 | 200 | 200 | BUG |
| 187 | reviews: stats route 6a0b1761 | 200 | 200 | BUG |
| 188 | reviews: review cffabd69 | 200 | 200 | explained |
| 189 | places: popular | 200 | 200 | explained |
| 190 | places: popular limit 3 | 200 | 200 | explained |
| 191 | places: search blank | 200 | 200 | explained |
| 192 | places: search "ha noi" | 200 | 200 | explained |
| 193 | places: search "Hồ Gươm" | 200 | 200 | explained |
| 194 | places: search "ben xe my dinh" | 200 | 200 | explained |
| 195 | places: search "san bay noi bai" | 200 | 200 | explained |
| 196 | places: search "da nang" | 200 | 200 | explained |
| 197 | places: search "x" | 200 | 200 | explained |
| 198 | places: search "zzzzqq" | 200 | 200 | explained |
| 199 | places: search near a point | 200 | 200 | explained |
| 200 | places: search lat without lon | 400 | 400 | identical |
| 201 | places: search limit 2 | 200 | 200 | explained |
| 202 | places: search limit 500 | 200 | 200 | explained |
| 203 | places: search no q | 400 | 400 | BUG |
| 204 | places: reverse Hà Nội | 200 | 200 | explained |
| 205 | places: reverse the sea | 200 | 200 | explained |
| 206 | places: reverse out of range | 200 | 400 | BUG |
| 207 | places: reverse no lon | 400 | 400 | BUG |
| 208 | places: reverse text | 400 | 400 | BUG |
| 209 | misc: campaigns | 200 | 200 | identical |
| 210 | misc: posts | 200 | 200 | identical |
| 211 | misc: post 004023d5 | 200 | 200 | identical |
| 212 | misc: payment providers | 200 | 200 | BUG |
| 213 | misc: oauth providers | 200 | 200 | identical |
| 214 | misc: me without a session | 401 | 401 | identical |
| 215 | misc: bookings without a session | 401 | 401 | identical |
| 216 | misc: unknown API route | 404 | 404 | explained |
| 217 | misc: media missing | 404 | 404 | identical |
| 218 | misc: media bad key | 404 | 404 | identical |
| 219 | misc: nullclaw status | 200 | 200 | explained |
| 220 | misc: presence without a session | 401 | 401 | identical |
| 221 | misc: trip detail bad id | 400 | 400 | BUG |
| 222 | misc: trip detail unknown id | 404 | 404 | identical |
| 223 | seo: robots.txt | 200 | 200 | explained |
| 224 | seo: sitemap.xml | 200 | 200 | explained |
| 225 | seo: ads.txt | 200 | 200 | explained |
| 226 | trip: detail 10ee7a5c@2026-11-16 | 200 | 200 | identical |
| 227 | trip: detail 10ee7a5c@2026-11-17 | 200 | 200 | identical |
| 228 | trip: detail 10ee7a5c@2026-11-18 | 200 | 200 | identical |
| 229 | trip: detail 10ee7a5c@2026-11-19 | 200 | 200 | identical |
| 230 | trip: detail 10ee7a5c@2026-11-20 | 200 | 200 | identical |
| 231 | trip: detail 10ee7a5c@2026-11-21 | 200 | 200 | identical |
| 232 | trip: detail 15806099@2026-11-16 | 200 | 200 | explained |
| 233 | trip: detail 15806099@2026-11-17 | 200 | 200 | explained |
| 234 | trip: detail 15806099@2026-11-18 | 200 | 200 | explained |
| 235 | trip: detail 15806099@2026-11-19 | 200 | 200 | explained |
| 236 | trip: detail 15806099@2026-11-20 | 200 | 200 | explained |
| 237 | trip: detail 3cfdb199@2026-11-16 | 200 | 200 | identical |
| 238 | trip: detail 3cfdb199@2026-11-17 | 200 | 200 | identical |
| 239 | trip: detail 3cfdb199@2026-11-18 | 200 | 200 | identical |
| 240 | trip: detail 3cfdb199@2026-11-19 | 200 | 200 | identical |
| 241 | trip: detail 3cfdb199@2026-11-20 | 200 | 200 | identical |
| 242 | user: auth/me | 200 | 200 | explained |
| 243 | user: my bookings | 200 | 200 | explained |
| 244 | user: my bookings limit 1 | 200 | 200 | identical |
| 245 | user: notifications | 200 | 200 | explained |
| 246 | user: loyalty | 200 | 200 | identical |
| 247 | user: my coupons | 200 | 200 | identical |
| 248 | user: my reviews | 200 | 200 | identical |
| 249 | user: price alerts | 200 | 200 | BUG |
| 250 | user: users list as a customer (forbidden) | 403 | 403 | BUG |
| 251 | user: admin stats as a customer (forbidden) | 403 | 404 | explained |
| 252 | user: booking by id | 200 | 200 | explained |
| 253 | user: booking by code | 200 | 200 | explained |
| 254 | user: payment of a booking | 200 | 200 | BUG |
| 255 | admin: stats | 200 | 404 | explained |
| 256 | admin: brands | 200 | 200 | explained |
| 257 | admin: routes | 200 | 200 | explained |
| 258 | admin: schedules | 200 | 400 | explained |
| 259 | admin: vehicle-types | 200 | 200 | identical |
| 260 | admin: bus-layouts | 200 | 200 | explained |
| 261 | admin: addresses | 200 | 400 | explained |
| 262 | admin: pickup-points | 200 | 400 | explained |
| 263 | admin: campaigns | 200 | 200 | explained |
| 264 | admin: coupons | 200 | 200 | explained |
| 265 | admin: payments | 200 | 200 | identical |
| 266 | admin: payments/summary | 200 | 200 | identical |
| 267 | admin: reviews | 200 | 200 | explained |
| 268 | admin: reviews/summary | 200 | 200 | identical |
| 269 | admin: bookings | 200 | 200 | explained |
| 270 | admin: bookings/stats | 200 | 200 | explained |
| 271 | admin: cron-jobs | 200 | 200 | explained |
| 272 | admin: system | 200 | 200 | explained |
<!-- PARITY-RESULTS:END -->
