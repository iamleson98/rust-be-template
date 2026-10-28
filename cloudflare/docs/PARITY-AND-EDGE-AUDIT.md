# Parity and edge audit (2026-10-20)

What this is: a check of the TypeScript/Cloudflare port against the Rust backend it replaced,
plus a check of how well the deployment uses Cloudflare (caching, bandwidth, SEO, abuse
protection, cost). Everything below was read from the code or measured against the live site
`https://datxevui.com`; nothing is inferred from memory. The Rust code is the specification.

**Scope of this pass, honestly:** the API surface, the campaigns/coupons feature (the example you
gave) and the edge/cache/SEO/rate-limit layer are audited in depth. The Rust services total about
20,000 lines (`src/service/**`) against about 4,800 in `cloudflare/src/lib/services/**`, so the
rest of the domain logic (bookings, payments, trips and search, auth, chat, reviews, loyalty,
price alerts) is **not yet line-by-line audited**: see "Not yet audited" for the plan.

## 1. API surface gaps

Compared the generated SDK (`src/spa/api/generated/sdk.gen.ts`, 155 operations, built from the
Rust OpenAPI) with the route handlers in `src/app/api/**`.

| Gap                                                                                                 | Effect                                                                              |
| --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `GET/POST/DELETE /api/admin/routes/{id}/pictures`, `PATCH/DELETE …/pictures/{pictureId}` not ported | Admins cannot upload, reorder or delete route pictures (only the public GET exists) |
| `PATCH /api/posts/{id}` is `PUT` in the port                                                        | The SPA calls PATCH; editing a post fails                                           |
| `DELETE /api/admin/reviews/{id}` missing (only PATCH)                                               | Admins cannot delete a review                                                       |
| `/api/routing/{directions,matrix,isochrone}` missing (documented in README as degrading gracefully) | Map routing features are off                                                        |
| `/api/webhooks/{zalo,messenger,telegram,discord}` missing                                           | Chat-bot channel integrations (src/routes/webhooks/\*) do not work                  |
| `/robots.txt` is a static file with different content (see section 4)                               | Lost `Disallow` rules and the sitemap pointer                                       |

Present and matching by path: auth (login, register, refresh, logout, me, password, employee
login, OAuth providers/start/callback), payments incl. IPN for MoMo, VNPay, ZaloPay, bookings,
campaigns, coupons, chat, presence, push, ads, stats, places, reviews, price alerts.

## 2. Campaigns and coupons: confirmed divergences

Rust reference: `src/service/campaign_service.rs`, `src/store/campaigns.rs`,
`docs/CAMPAIGNS.md`. Port: `src/app/api/campaigns/**`, `src/app/api/coupons/**`,
`src/lib/services/{lookups,campaign-out,booking}.ts`.

### Correctness and money

1. **Coupon brand scope is not enforced on bookings.** Rust `coupon_discount` rejects a coupon
   whose campaign does not cover the booking's operator (`coupon_not_for_this_operator`, unless
   `all_brands`). `booking.ts:295-304` checks only holder, status and expiry, so a coupon for brand
   A can discount a brand B booking, and the operator is then charged in the payout ledger.
2. **Error contract broken.** The SPA translates coupon errors by checking whether the error
   _message_ ends with a stable code (`src/spa/features/campaigns/api.ts:30-47`:
   `customers_only`, `campaign_not_running`, `coupon_already_held`, `campaign_already_claimed`,
   `tier_sold_out`, `try_again`, `coupon_unavailable`, `coupon_expired`,
   `coupon_not_for_this_operator`). Rust sets the message to exactly that code. The port returns
   English sentences and its own codes (`already-claimed`, `sold-out`, `not-running`,
   `coupon not held by you`, …), so customers see untranslated English, and the mobile app and
   any code matching on those strings misbehave.
3. **Claim eligibility is weaker.** Rust: only `role == "user"`, not guest, not bot, status
   `active` (claim 246-251). Port: only excludes admin and employee, so guests, bots and blocked
   accounts can claim.
4. **Claim is not atomic.** Rust does it in one store transaction. The port runs the slot
   increment, then the insert, then a compensating decrement on failure
   (`claim/route.ts:98-155`): a Worker killed between statements leaks a slot. D1 `batch()` is
   available (`atomicBatch` already exists and is used by give-up). Also the unique index on
   `active_holder` makes a concurrent double-claim surface as "try-again" instead of "already held".
5. **Coupon codes.** Rust: `DXV` + 7 chars from an unambiguous alphabet using a CSPRNG. Port:
   `DXV-` + year + `Math.random()` base36. Codes are bearer values, so use
   `crypto.getRandomValues` and the original alphabet.
6. **Public list shows only currently running campaigns.** Rust returns every non-paused
   campaign that has not ended (running **and upcoming**), and the SPA has an `upcoming` state
   that depends on it (`campaign-spotlight.tsx`). Port filters `startsAt <= now`.
7. **State names differ.** Port: `scheduled`; Rust: `upcoming` (admin list/detail).
   Precedence also differs (Rust: ended, then paused, then upcoming, then running).
8. **Tier order.** Rust sorts public tiers by amount descending; port by position then amount.

### Cache behaviour

Rust: one entry (`campaigns:public:v1`), 15 s TTL, claims write the exact remaining count into
the cached copy (never raising it), sold-out and give-up and every admin write invalidate it,
ended campaigns are trimmed at read time, `serverTime` is always fresh.

Port (`src/lib/db/cache.ts`, `lookups.ts`): L1 per-isolate memory (30 s) plus KV (300 s).

- **Invalidation does not reach other isolates.** `cacheInvalidatePrefix` clears the caller's
  isolate and KV only. Other isolates (a busy colo runs many) serve their L1 copy for up to 30 s;
  KV deletions propagate over up to about 60 s. Real staleness is therefore around 90 s, not
  Rust's 15 s, exactly when a limited-slot campaign is hot.
- **A claim storm turns into KV list+delete storms.** Every claim runs `KV.list` + `KV.delete`
  (billed per operation) and the next reader re-`put`s the key; Workers KV allows one write per
  second per key, so concurrent refills get 429s that are swallowed.
- **Give-up does not invalidate** (`coupons/mine/route.ts` DELETE), so a freed slot is not shown.
- **Ended campaigns stay in the cached list** until the TTL, because the date filter runs when
  the cache is _loaded_, not at read (Rust re-filters on every read).
- Money-critical paths are correct: claims go straight to D1 and the conditional UPDATE is the
  source of truth, so stale display never oversells. The defect is display staleness and cost.

Recommended design: drop KV for this endpoint. Serve `GET /api/campaigns` from the Workers Cache
API (free, per colo, `s-maxage=10`) plus a per-isolate copy with the Rust write-through semantics
(claim writes the exact remaining count into the local copy). Over-display for at most 10 s is
harmless because the claim itself is authoritative.

## 3. Rate limiting and abuse protection

| Control                                                            | Rust                                                    | Port                                                                                               |
| ------------------------------------------------------------------ | ------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Per-IP limit on **every** `/api` request                           | tower_governor, 600 rpm, burst 100, keyed on client IP  | **None in the Worker.** 13 routes limit per user or per email; reads and anonymous routes are open |
| WAF/edge rule                                                      | n/a                                                     | Documented in `README-CLOUDFLARE.md`, **not created**; the free plan allows one rule               |
| Login brute force                                                  | n/a (rate limit only)                                   | D1 lockout (5 failures, 15 min) + `AUTH_LIMITER` per account. Better than Rust                     |
| User-Agent blocklist (curl, python, headless, …)                   | `anti_scraping.rs`                                      | Not ported (live check: `curl` gets 200 everywhere)                                                |
| Origin/Referer required on mutations                               | `anti_scraping.rs` (CSRF-style defence for cookie auth) | Only on WebSocket upgrades (`ws-auth.ts`); not on HTTP mutations                                   |
| Security headers (HSTS, nosniff, X-Frame-Options, Referrer-Policy) | `router.rs:399-421`                                     | **None** on HTML or API (measured); only `nosniff` on `/api/media`                                 |

Recommendations, cheapest first:

1. **One per-IP binding in `custom-worker.ts`, before Next.js runs.** Add an `IP_LIMITER`
   (`ratelimits` binding, 60 s period) keyed on `CF-Connecting-IP`, with **IPv6 collapsed to its
   /64** (a single user owns a whole /64, so per-address keys are trivially bypassed). As far as Cloudflare's
   pricing page showed when this was written the binding has no separate charge (re-check before
   relying on it), and it adds negligible latency. Use two classes: a generous one for
   reads (match Rust's 600/min) and a strict one for auth, uploads and anything that fans out to
   D1 (search, trips).
2. **Create the one free WAF rate-limit rule** for `/api/*` per IP as the outermost brake, so a
   flood never even invokes the Worker (WAF blocks are not Worker requests, which is the part
   that saves money). Add Bot Fight Mode; it covers what the UA blocklist tried to.
3. **Origin/Referer check on cookie-authenticated mutations**, with the Rust exemptions (payment
   IPN webhooks, native clients sending `X-Client: mobile`).
4. **Security headers** once, in `custom-worker.ts` for dynamic responses and in
   `public/_headers` for assets (or a free Transform Rule): HSTS, `nosniff`, `X-Frame-Options:
DENY`, `Referrer-Policy: strict-origin-when-cross-origin`. Add a CSP in report-only mode first.
5. WebSocket upgrades (`/ws`, `/ws-call`) should be counted by the same per-IP limiter so a
   client cannot open thousands of Durable Object connections.

## 4. Caching, bandwidth and SEO (measured on the live site)

| URL                                                                                     | Measured `cache-control`                 | Problem                                                              |
| --------------------------------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- |
| `/`, `/privacy` (HTML)                                                                  | `private, no-cache, no-store, max-age=0` | Every page view runs the Worker; the shell is identical for everyone |
| `/hero-vietnam-bus.avif`, `/logo.svg`, `/manifest.webmanifest`, `/sw.js`, `/robots.txt` | `public, max-age=0, must-revalidate`     | Browser revalidates every view (a request per asset per visit)       |
| `/api/brands`, `/api/stats`, `/api/campaigns`                                           | none                                     | Not cacheable by browser or edge; every visitor reaches D1/KV        |
| `/sitemap.xml`                                                                          | `public, max-age=3600`                   | fine                                                                 |
| `/_next/static/*`                                                                       | `immutable` (from `_headers`)            | fine                                                                 |

Rust served hashed assets as `immutable` for a year, other static files for a day, and never
cached `index.html`.

Recommended:

- **`public/_headers`:** `max-age=86400, stale-while-revalidate=604800` for fonts, icons, images
  and hero images; `no-cache` stays for `sw.js` only. Removes a revalidation request per asset per
  visit. Static asset requests are free and unlimited on Workers, so this saves latency and
  mobile data rather than money.
- **Public JSON GETs:** add `Cache-Control: public, s-maxage=30, stale-while-revalidate=120` to
  brands, stats, routes list, review tags, campaigns (10 s), and serve them through the Workers
  Cache API. The edge answers repeat requests with no D1 read and no KV operation. Auth, booking
  and seat endpoints stay `private, no-store`.
- **HTML shell:** it is the same for every visitor. Make it static (`dynamic = "force-static"`
  or prerender) so it can be cached; a page view then costs no render CPU.
- **KV tier:** replace with the Cache API for shared per-colo caching (KV costs per read, write
  and list; the Cache API is free).
- **Workers Logs** (`observability.enabled`): set a `head_sampling_rate` once traffic grows; log
  volume is billed past the included quota.

### SEO regressions against the Rust build

- The whole UI is `ssr: false` (`src/app/[[...slug]]/page.tsx`), so the HTML crawlers and link
  scrapers (Zalo, Facebook, Twitter do not run JavaScript) receive a spinner. The Rust build
  **prerendered** the homepage and the `/privacy` and `/terms` text (`frontend/prerender.mjs`);
  the port serves 21 KB of shell for `/privacy` with **no policy text**, which also matters for
  the OAuth app reviews that read it.
- **Every page declares the homepage as canonical** (`layout.tsx` sets `alternates.canonical`
  once; measured `rel="canonical" href="https://datxevui.com"` on `/privacy`). Per-route titles
  and descriptions exist only client-side (`route-meta.tsx`), so the server always sends the
  homepage title.
- **`www.datxevui.com` and `datxevui.com` both return 200** (I attached both as Worker domains).
  Two hosts with the same content split ranking; add a Redirect Rule (free): `www` to apex, 301.
- `robots.txt` lost `Disallow: /api/ /admin/ /bookings/ /payments/` and the `Sitemap:` line.
  Add them (and fix the `Crawl-delay`, which Google ignores anyway).
- Sitemap lists only the homepage group and brand pages with today's date as `lastmod`
  (identical to Rust, so not a regression, but a real `updated_at` per brand is better).

Recommended: per-route `generateMetadata` and server-rendered content for the public routes
(`/`, `/search`, `/brands/[slug]`, `/privacy`, `/terms`), self-referencing canonicals, JSON-LD per
brand, and keep the SPA for interactive screens.

## 5. Not yet audited (plan)

Each is an independent audit-and-fix unit with its own Rust test file to port as the oracle
(Rust tests: `campaign_tests.rs` 795 lines, `pricing_tests.rs`, `ticket_tests.rs`):

1. Bookings and seat holds (**done, see 5.1**): `booking_service.rs` (1,555 lines), `seat_plan*.rs`, `fares.rs`, hold
   expiry, ticket lifecycle and phone-confirm flow.
2. Payments (**done, see 5.1**): `payment_service.rs` (1,322), IPN verification and idempotency, COD, refunds.
3. Trips and search (**done, see 5.2**): `trip_search.rs`, `trip_warmer.rs`, `trip_stops.rs`,
   `public_service.rs` (1,558), recommendations, facets.
4. Auth and users (**done, see 5.3**): `auth_service.rs`, RBAC, OAuth, guest accounts, notifications.
5. Chat, reviews, loyalty, price alerts, posts, ads, jobs/scheduler, route media pipeline
   (`route_media_service.rs`, 697 lines: thumbnails, content-addressed keys).

Method for each: list Rust behaviours (including error codes and status transitions), port the
Rust unit tests as workerd tests against the same fixtures, and fix what fails. The campaign
section above is the template.

### 5.1 Bookings, seat holds, tickets and payments (audited and fixed)

Scope: `src/service/{booking_service,booking_view,payment_service,fares,trip_time,trip_stops,seat_plan*}.rs`,
`src/store/{booking,payment}.rs`, `src/routes/{bookings,payments}.rs` (IPN included),
`src/routes/admin/bookings.rs` + `admin_service/bookings.rs`, `src/payment/*`, and the Rust tests
`pricing_tests.rs`, `ticket_tests.rs` and the unit tests inside the files above. Port side:
`src/lib/services/{booking,booking-out,payment,seat-plan,fares,trip-time,trip-stops,admin-bookings}.ts`,
`src/app/api/{bookings,payments,admin/bookings,admin/payments}/**`.

**Method.** Every behaviour below was read in the Rust source and in the port, then settled by a
workerd test against a fixture equivalent to Rust's `test_support.rs` (real D1 and the real
migration chain). Rust tests ported 1:1: `booking_service.rs` (hold, lifecycle, sweep),
`payment_service.rs`, `pricing_tests.rs`, `ticket_tests.rs`, `fares.rs`, `trip_time.rs`,
`trip_stops.rs`, `vietqr.rs`, `seat_plan_presets.rs`, plus new tests for what Rust implements but
does not test (IPN signatures, amounts, idempotency). **Honest limit:** the Rust tests themselves
were not executed here (the `rust-sql` submodule is not checked out in this worktree, so `cargo
test` cannot build); the Rust side is the specification as read, not as run.

Status key: **OK** same as Rust · **FIXED** diverged, now same (test in brackets) · **DELIBERATE**
differs on purpose, reason given · **ASK** Rust itself looks wrong, see "Questions" below · **N/A**
not applicable on Workers.

Line numbers: Rust `file:line` on `master`; "before" is `feat/cloudflare-migration` at 7f05061;
"after" is this branch.

#### Divergences that moved money or lost data (all FIXED)

1. **Every departure was read as UTC, not Vietnam time.** Before: `booking.ts:234,495,593`
   (`…T${departureTime}:00Z`). The 08:30 bus was treated as leaving at 08:30 UTC = 15:30 Vietnam, so
   "trip already departed", "cannot cancel after departure", refund tiers and the pay-on-board hold
   all ran seven hours late (a customer could cancel a bus that had left for up to 7 h, and got the
   90 % tier up to 7 h too long). After: `trip-time.ts:41` (`departureInstant`, Rust
   `trip_time.rs:33`). _Also_: the booking view's `departureAt` was a bare `YYYY-MM-DDTHH:MM:00`
   string, now RFC 3339 UTC like Rust (`booking-out.ts`, `booking_view.rs:24`).
2. **Coupon was redeemed (payable to the operator) when the booking was paid, not when the trip
   happened.** Before: `booking.ts:614-631`, three IPN routes, `admin/bookings/[id]`. Rust redeems in
   `complete_booking` only (`store/booking.rs:569-591`, `campaigns.rs:335`), and returns the coupon
   when a _confirmed_ booking is cancelled (`booking.rs:659-660`). So in the port a customer who paid
   and then cancelled kept the discount consumed and the operator was still charged for it. After:
   `booking.ts:723` (`completeBooking`) is the only redeemer; cancel and expiry return it
   (`booking.ts:666`).
3. **Customer ticket list dropped cancelled and completed tickets.** Before:
   `api/bookings/route.ts` filtered `status in (pending, confirmed)` and _included unfinished
   checkouts_. Rust lists "placed" bookings: `payment_method IS NOT NULL OR status IN
(confirmed, completed)` (`store/booking.rs:115-121`). The admin list had the same hole (it showed
   every checkout). After: `booking-out.ts:360-407`, `admin-bookings.ts:71`.
4. **Pay-on-board never recorded `payment_method = cod`.** Before: `booking.ts:584-608` set only the
   expiry, so the admin `awaiting` filter (`pending` + `cod`) and the "placed" rule above could not
   see the ticket; the place route answered `status: confirmed` when the row was missing. After:
   `booking.ts:853` (`placeCash`, Rust `booking_service.rs:687`).
5. **Staff "confirm" completed the cash payment, and zero-total COD completed itself.** Before:
   `admin/bookings/[id]:70` marked pending payments `completed`; `payment.ts:220-227` confirmed a
   fully-discounted COD booking at once. Rust leaves the payment `pending` until staff record the cash
   (`mark_cod_collected`), and keeps a zero-total booking `pending` for the operator's phone call
   (`payment_service.rs:175-196`). Fixed: revenue/collected figures no longer count cash that was
   never received.
6. **Cancelling marked completed payments `refunded`.** Before: `booking.ts:542-549`, admin cancel.
   Rust only reports the refund (`booking_service.rs:657-682`); the payment stays `completed`
   (`store/booking.rs:662-675` cancels _pending_ payments only). **ASK Q4**: Rust's behaviour is
   mirrored, but it looks incomplete.
7. **Sweep did not cancel pending payments and restored the counter from `booking_seat` rows.**
   Before: `booking.ts:666-728`. After: one batch per chunk that cancels the pending payments
   (`failure_reason = "booking cancelled"`), re-checks `expires_at < now` (a payment may have
   extended the hold since the listing), frees seats, and adds back exactly the inventory rows it
   freed (`booking.ts:666`, Rust `store/booking.rs:597-685`).
8. **IPN handlers accepted unsigned callbacks when a secret was missing in `development`, never
   checked amounts, and used made-up signature formulas.** Before: `api/payments/ipn/*`. MoMo signed
   a dot-joined string with an `orderCode` field MoMo never sends; ZaloPay verified with `key1`
   (Rust: `key2`); VNPay accepted `vnp_ResponseCode=00` without `vnp_TransactionStatus=00` and
   without an amount check. A callback for a _wrong amount_ would confirm the booking. After:
   `payment.ts:897-1020`, signatures exactly per `vnpay.rs:147`, `momo.rs:226`, amount mismatch →
   `failed` with `amount mismatch: expected X, got Y`.
9. **VietQR payload differed from Rust** (`payment.ts:64-90` before: no service code `5769`, MCC
   `0000` instead of `4111`, no bill number, account name inside the QR). Scanners that validate
   the NAPAS template may reject such a code. VietQR is enabled in
   production (`wrangler.jsonc: VIETQR_ENABLED=true`). After: `payment.ts:231`, byte-for-byte the
   Rust layout; the test pins the whole string and its CRC (checked independently).
10. **Hold priced the adult leg from the fare table instead of the seat's price, trusted the client's
    `type: "child"`, applied the child rules in the wrong order and did not clamp** (before:
    `booking.ts:78-92,273-290`). Rust: `fares::ticket(age, inventory.final_price, fare, policy)`;
    type ignored, no age = adult, class child price beats brand discount, never above the adult
    price. After: `fares.ts:90-102`, `booking.ts:411`.
11. **Fare edits never re-priced unsold seats** (`admin/schedules/[id]` had no `reprice_upcoming`),
    so search showed stale prices. After: `fares.ts:113` called from the schedule PUT and the
    layout-plan replace (Rust `schedules.rs:326`, `bus_layouts.rs:266`).
12. **Trip warmer treated every non-JSON weekday mask as "daily".** Rust stores a 7-character
    mask (`1111100`); D1 holds the migrated masks, and `json_array_length('1111100')` is 0, so
    weekday-only schedules were generated every day (`booking.ts:751` before). After:
    `booking.ts:925` (`runsOnDate`, accepts the mask and the port's older JSON array).
    **Not fixed (out of this scope):** the same SQL clause in `trip-search.ts:506` and `:687`.

#### Behaviour table — hold (`BookingService::hold`)

| Behaviour                                                                                                                                                                                              | Rust                                                  | Port before                                                 | Status                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Request rules: seats 1–50, passengers 1–50, name 1–255, age 0–150, contact name ≤255, phone (`+` ≤16 or `0…` 9–20 digits), email                                                                       | `dto/booking.rs:15-60`, `validation.rs:26`            | `booking.ts:225-232` (40 seats, no phone/email/age rule)    | FIXED `validateHoldRequest` (`booking.ts:155`)                                                                 |
| Empty seats / blank contact → 400 `missing required fields`                                                                                                                                            | `booking_service.rs:191`                              | message differed                                            | FIXED                                                                                                          |
| Passenger count ≠ seat count → 400 `passenger count must match seat count`                                                                                                                             | `:197`                                                | message differed                                            | FIXED                                                                                                          |
| Unknown trip 404 `trip not found`                                                                                                                                                                      | `:210`                                                | OK                                                          | OK                                                                                                             |
| Cancelled trip → **400** `trip is cancelled`                                                                                                                                                           | `:212`                                                | 409                                                         | FIXED                                                                                                          |
| Departed trip → **400** `trip has already departed`, uses `actual_departure_at` when set                                                                                                               | `:226`                                                | 409, UTC                                                    | FIXED                                                                                                          |
| Sell window: > 14 VN days out → 400 `bookings open 14 days before departure`; malformed date skipped                                                                                                   | `:242-255`                                            | `Only trips within 14 days…`, float days from UTC           | FIXED (`booking.ts:87`)                                                                                        |
| Boarding/dropping must be stops of the trip, both required when it has any, boarding first; stops copied onto the booking (name/address/lat/lon); no stops → route cities                              | `trip_stops.rs:107-125`, `booking_service.rs:276-296` | ids stored raw, no check, no snapshot                       | FIXED (`trip-stops.ts`)                                                                                        |
| Only route pickup points are stored as `boarding/dropping_point_id`                                                                                                                                    | `:294`                                                | n/a                                                         | FIXED                                                                                                          |
| Trip with no seat rows is filled on first hold, priced per class; partial inventories are not "healed"                                                                                                 | `trip_warmer.rs:351-398`                              | filled missing rows one by one                              | FIXED (`booking.ts:252`)                                                                                       |
| Missing seat/inventory → 400 `some seats not found or changed`; held/booked seat → **409** `some seats are no longer available`                                                                        | `:310-325`                                            | 400 `unknown seat id`, checked layout membership separately | FIXED                                                                                                          |
| Duplicate seat ids (surfaces as the 400 above), passenger→seat pairing by named `seatId` or by position, a seat used once                                                                              | `:934-966`                                            | no `seatId` support                                         | FIXED                                                                                                          |
| Child price: age ≤ brand `child_max_age`; class `price_child` beats `adult − discount`; clamp to [0, adult]; type ignored; no age = adult                                                              | `fares.rs:204-217`                                    | wrong precedence, trusted `type`                            | FIXED                                                                                                          |
| Class fares: `schedule_fare` by normalised class, else `base_price_adult`                                                                                                                              | `fares.rs:83-130`                                     | same, un-normalised class                                   | FIXED (`classOf`)                                                                                              |
| Coupon: holder = `active_holder`, status `held`, window open, **brand scope** (`all_brands` or `campaign_brand`), codes `coupon_unavailable` / `coupon_expired` / `coupon_not_for_this_operator` (400) | `campaign_service.rs:100-134`                         | holder = `user_id`, no scope, English sentences             | FIXED (`booking.ts:199`)                                                                                       |
| Discount clamped to [0, subtotal]; fees 0; total ≥ 0                                                                                                                                                   | `:381-383`                                            | OK                                                          | OK                                                                                                             |
| Hold TTL 10 min, 20 min when the trip is ≥ 3 **Vietnam** days out; malformed → 10                                                                                                                      | `:48-60`                                              | UTC midnight maths                                          | FIXED (`booking.ts:101`)                                                                                       |
| Booking code `PREFIX-` + 6 of `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`; prefix = first letter per slug segment, `BK` if empty                                                                                | `:857-880`                                            | prefix fell back to the route name                          | FIXED (empty slug → `BK`)                                                                                      |
| Seat claim is all-or-nothing; failure leaves no booking/seat/booking_seat rows                                                                                                                         | `:444-500`                                            | OK in effect                                                | OK (D1: one conditional UPDATE with the ids as a single JSON parameter, so 50 seats fit the 100-parameter cap) |
| Coupon reserved as the last step; a raced coupon undoes the hold (seats freed, booking deleted) → 409 `coupon_unavailable`; **counter decremented only after that**                                    | `:539-577`                                            | decrement happened before and was never restored on undo    | FIXED                                                                                                          |
| Counter is `available_seats - n` computed by the engine (not floored)                                                                                                                                  | `:573`                                                | `MAX(…,0)`                                                  | DELIBERATE-none: now plain subtraction like Rust                                                               |
| Response: `bookingId, code, status, subtotal, discount, fees, total, expiresAt, seats[{seatId, seatCode, seatClass (default "standard"), passengerName/Type/Age, price}], couponId?`                   | `dto/booking.rs:200-215`                              | 201, `seatClass` raw/absent                                 | FIXED. Status is **200**, as Rust (the OpenAPI says 201 but the handler returns a bare `Json`)                 |
| `POST /api/bookings/hold` alias                                                                                                                                                                        | `routes/bookings.rs:150`                              | missing (405)                                               | FIXED                                                                                                          |
| Guest (unauthenticated) hold                                                                                                                                                                           | 401 via `AuthUser`                                    | OK                                                          | OK                                                                                                             |
| `campaign_applied_id` column                                                                                                                                                                           | written `NULL`                                        | holds the coupon id                                         | DELIBERATE: harmless, nothing reads it (coupon found by `booking_id`)                                          |
| Rate limit on hold                                                                                                                                                                                     | none                                                  | `limitWrite("booking")`                                     | DELIBERATE: port-only abuse guard                                                                              |

#### Behaviour table — lifecycle (confirm, place, cancel, expire, complete)

| Behaviour                                                                                                                                                                                                                                                     | Rust                             | Port before                                            | Status                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------- |
| `confirm_pending`: only `pending` **and** all seats still held by it; seats → `booked`, `held_until` cleared, method stored; lost race = nothing changes                                                                                                      | `store/booking.rs:435-500`       | `completeBookingPayment` flipped whatever it found     | FIXED (`booking.ts:628`, single guarded batch)                          |
| `confirm_as_system`: confirmed → idempotent OK; other status → 409 `booking is X`; seats lost → **410** `booking hold has expired`; late payment confirms until the sweep ran                                                                                 | `booking_service.rs:750-796`     | none of these                                          | FIXED (`booking.ts:872`)                                                |
| `place_cash`: owner check (403 `not your booking`), status ≠ pending → 400, expired → 410 **and the seats are given back at once**, holds until departure (or +1 day if unknown), method `cod`, response `{bookingId, status:"pending", paymentMethod:"cod"}` | `:687-716`                       | 409, no release, wrong response                        | FIXED (`booking.ts:853`)                                                |
| `hold_for_payment`: +15 min while a gateway payment runs                                                                                                                                                                                                      | `:737`                           | not present                                            | FIXED (`booking.ts:844`)                                                |
| `cancel`: 404/403, `cancelled` → 400 `booking already cancelled`, `completed` → 400 `a completed booking cannot be cancelled`, **any open booking** after departure → 400 `the trip has already left`, lost race → 409                                        | `:614-653`                       | 404 for strangers, departure check only when confirmed | FIXED (`booking.ts:795`)                                                |
| Refund: `paid = Σ completed payments`; `>24 h → 90`, `>4 h → 50`, else 0 (strict, whole minutes); unknown departure → 90; `amount = paid × % / 100` (floor); computed even for unpaid-pending (then 0)                                                        | `:657-682`, `trip_time.rs:78-86` | `>=` boundaries, % forced 0 unless confirmed           | FIXED (`trip-time.ts:105`, `booking.ts:773`)                            |
| `refCode = HX-{CODE}-{BASE36(ms) upper}`, `success:true`, `cancelledAt`, `reason` echoed (≤1000 chars)                                                                                                                                                        | `:644-652`                       | lower-case code                                        | FIXED                                                                   |
| Release body (cancel/expiry): seats free (held _and_ booked), counter += freed rows, coupon back to owner while valid else `expired`, pending payments → `cancelled`                                                                                          | `store/booking.rs:597-685`       | partial (see 7)                                        | FIXED (`booking.ts:666`, one atomic batch)                              |
| Sweep: oldest first, ≤200 per run, 60 s tick; returns `{bookings, seats}`                                                                                                                                                                                     | `:801-823`                       | returned only `{cancelled}`                            | FIXED (`{cancelled, seats}`; the job summary changed shape accordingly) |
| `complete_booking`: `confirmed → completed` and redeem coupon, atomically                                                                                                                                                                                     | `store/booking.rs:569`           | only an unguarded UPDATE                               | FIXED (`booking.ts:723`)                                                |
| Loyalty: points are _computed_ from `completed` bookings (1 per 10 000 VND, floor per booking)                                                                                                                                                                | `loyalty_service.rs:98`          | OK (`api/loyalty/route.ts:56`)                         | OK, now reachable because completion is guarded and final               |

#### Behaviour table — views and listings

| Behaviour                                                                                                                                                                                                                                                                                               | Rust                                       | Port before                | Status                       |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | -------------------------- | ---------------------------- |
| `GET /api/bookings`: placed tickets of the caller, newest first, `limit` default 50 max 200, `offset`                                                                                                                                                                                                   | `bookings.rs:27`, `booking_service.rs:125` | cap 100, wrong filter      | FIXED                        |
| `GET /api/bookings/{id}`: by UUID or by code (trimmed, any case); **403** for a stranger; QR only for pending/confirmed and only on the single view; QR is an SVG data URI of the code                                                                                                                  | `:147-162`, `booking_view.rs:304-345`      | 404 for strangers          | FIXED                        |
| `BookingOut`: optional fields omitted rather than `null`; seats sorted by code; `seatClass` raw (none for standard); stops fall back booking → legacy route point → route city; `canCancel = open && !departed`; trip block with `departureAt`, `fromName/toName`, brand name/logo, layout name; review | `booking_view.rs:59-300`                   | nulls, naive `departureAt` | FIXED (`booking-out.ts:135`) |
| Booking `price` per seat                                                                                                                                                                                                                                                                                | `i64`                                      | OK                         | OK                           |

#### Behaviour table — payments

| Behaviour                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Rust                                                       | Port before                                          | Status                                                                                                                                                                               |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Providers (order `momo, vnpay, zalopay, cod, vietqr`); active = enabled **and** credentials present (VietQR also needs the account name); COD default on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `config/mod.rs:1035-1190`, `payment_service.rs:114-136`    | other order, VietQR active without account name      | FIXED (`payment.ts:82-156`)                                                                                                                                                          |
| `POST /api/payments`: provider length 1–16 and in the list (`invalid provider: x (allowed: …)`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `dto/payment.rs:43`                                        | different message                                    | FIXED                                                                                                                                                                                |
| Order of checks: 404 booking → ownership (owned booking + signed out = 401, other user = 403, legacy owner-less booking open) → status must be `pending` (400 with current status) → hold alive (410) → total ≤ 0 only COD (400) → place/extend hold → cancel prior pending (`superseded by new payment`) → provider                                                                                                                                                                                                                                                                                                                                                                                             | `:147-200`                                                 | status never checked; ownership in the route only    | FIXED                                                                                                                                                                                |
| Disabled provider is rejected **before** the hold moves and the previous payment is cancelled                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Rust does it after (`:203`)                                | n/a                                                  | **ASK Q6** — reordered on purpose                                                                                                                                                    |
| COD: hold until departure, `payment_method = cod`, payment stays `pending`; amount = booking total                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `:183-191`, `cod.rs`                                       | auto-completed when total 0                          | FIXED                                                                                                                                                                                |
| Payment row: `provider_txn_ref` (VX+ms+6 random; VietQR: a fresh uuid; ZaloPay: `app_trans_id`), memo `VEXEVN-{CODE}`, `provider_response`, `created_by`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `:216-251`                                                 | VietQR memo/ref differed                             | FIXED                                                                                                                                                                                |
| Response `{payment}` with `returnUrl = {base}/payments/{paymentId}/return`, VietQR `bankTransferInstructions` (BIN→name table), QR image only in the create response                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | `:1013-1060`                                               | image on every read, name from env                   | DELIBERATE: SVG instead of PNG (no canvas on Workers); `VIETQR_BANK_NAME` kept as an override; the image is now create-only like Rust                                                |
| VNPay create: params, sort, `%XX` upper-case percent-encoding, HMAC-SHA512, `vnp_IpnUrl`, `vnp_OrderType=other`, 15-min expiry, sandbox unless `VNPAY_ENV=production` (live host `payment.vnpayment.vn`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | `vnpay.rs:66-145`, `config/mod.rs:1082`                    | other params, wrong live host, `APP_ENV` switch      | FIXED (`payment.ts:297`). **ASK Q1** (dates are UTC in Rust)                                                                                                                         |
| MoMo create over HTTPS (`captureWallet`), signature string, `resultCode != 0` → 400, network → 503                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `momo.rs:63-224`                                           | returned no gateway URL                              | FIXED (`payment.ts:366`). **ASK Q3**                                                                                                                                                 |
| ZaloPay create (`app_trans_id = yymmdd_CODE`, MAC over `app_id                                                                                                                                                                                                                                                                                                \| trans                                                      \| user                                                 \| amount                                                                                                                                                                               \| time \| embed \| item` with key1) | `zalopay.rs:66-190`                                        | not implemented                                      | FIXED (`payment.ts:411`). **ASK Q2**                                                                                                                                                 |
| IPN VNPay (`GET`): verify HMAC over all params but the hash fields (exact compare), look up by `vnp_TxnRef`, **already terminal ⇒ no-op**, success needs `ResponseCode=00 && TransactionStatus=00`, `vnp_Amount == amount×100` (skipped if absent), else `failed` with the codes; reply `RspCode` 00 / 01 order not found / 97 anything else, always HTTP 200                                                                                                                                                                                                                                                                                                                                                    | `payment_service.rs:429-511`, `routes/payments.rs:290-318` | `code`/`message` keys, no amount check               | FIXED (`payment.ts:897`, route)                                                                                                                                                      |
| IPN MoMo (`POST`): signature over the 13 sorted fields with `accessKey`, constant-time compare, `resultCode 0` + exact amount, `providerTransId = transId`; reply `code` 0/1/2                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | `momo.rs:226-262`, `payment_service.rs:514-578`            | made-up string                                       | FIXED (`payment.ts:946`)                                                                                                                                                             |
| IPN ZaloPay: MAC with key2, `app_id` must match, `zp_trans_id > 0` + exact amount; reply `return_code` 1/2/3                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `zalopay.rs:213-245`, `payment_service.rs:581-657`         | key1, no amount                                      | FIXED (`payment.ts:990`). **ASK Q2**                                                                                                                                                 |
| Completing a payment: payment `completed` + `provider_trans_id` + response, booking confirmed with the provider as method; if the booking can no longer be confirmed the payment is still completed and `failure_reason = "paid, but the booking could not be confirmed: …"`                                                                                                                                                                                                                                                                                                                                                                                                                                     | `:876-971`                                                 | no note                                              | FIXED. Order is _confirm first, then complete_ (Rust: complete first) so a killed Worker leaves a retryable `pending` payment instead of a paid-but-unconfirmed booking (DELIBERATE) |
| `mark_cod_collected`: staff only (`admin:payments:write`), COD and `pending` only (400 otherwise), stores `collected_at/by`, confirms the booking, answers with `amountCollected` (body or amount)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | `:368-424`                                                 | idempotent 200, 409s, no `amountCollected` body      | FIXED (`payment.ts:853`)                                                                                                                                                             |
| User cancel of a payment: ownership, only `pending` (400 with status), reason stored; booking untouched                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `:320-362`                                                 | no ownership check                                   | FIXED                                                                                                                                                                                |
| `GET /api/payments/{id}`, `/booking/{id}`: ownership by payment user else booking user; list newest first, no `total`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | `:273-315`                                                 | role-based bypass                                    | FIXED                                                                                                                                                                                |
| Admin list (`status`, `provider`, limit default 20 max 200, `total`, `bookingCode`); there is no GET-by-id route in Rust's admin router                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `:661-725`, `routes/payments.rs` `admin_router`            | cap 100                                              | FIXED                                                                                                                                                                                |
| Admin summary: counts per status and `collected` = **sum of completed amounts**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `:728-752`                                                 | `collected` was a row count                          | FIXED (money figure on the console)                                                                                                                                                  |
| Admin status override: any of the five statuses (400 listing them), reason kept when omitted, `completed` also confirms the booking and flags a failure                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `:786-834`                                                 | restricted transitions, reason overwritten with null | FIXED                                                                                                                                                                                |

#### Behaviour table — staff tickets (`/api/admin/bookings`)

| Behaviour                                                                                                                                                                                                                                                                                                                             | Rust                                      | Port before                                                          | Status                      |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------- | --------------------------- |
| List: tickets only, `status` or `awaiting` (= pending + cod) or `all`, brand/route through the trip, search over code/name/phone, Vietnam-day `dateFrom..=dateTo` (400 `x is not a YYYY-MM-DD date`), sort `created_asc/total_desc/total_asc`, limit default 50 max 200                                                               | `admin_service/bookings.rs:25-40,260-310` | UTC dates, `departure_*` sorts instead of totals, default 20/cap 100 | FIXED (`admin-bookings.ts`) |
| Status machine: pending→confirmed (method kept, default cod; seats lost → 410, raced → 409), confirmed→completed (400 until the trip left), open→cancelled, completed/cancelled final (409 `ticket CODE is X and can no longer change`), anything else 400 `a X ticket cannot become Y`; audit log `booking_{status}` with the reason | `:53-125`                                 | looser checks, no audit                                              | FIXED                       |
| Stats: per **Vietnam** day, `pending` bucket counts every non-confirmed/completed/cancelled status, revenue = confirmed + completed                                                                                                                                                                                                   | `:138-182`                                | UTC `date()`                                                         | FIXED                       |
| CSV export: 7 columns, BOM, every value quoted, 1000-row pages without a cap, `bookings_export_YYYYMMDD_HHMMSS.csv`                                                                                                                                                                                                                   | `:184-240`                                | different columns, 10 000 cap                                        | FIXED                       |

#### Behaviour table — seat plan (`seat_plan*.rs`)

| Behaviour                                                                                                                                                                                                            | Rust                                           | Port before                                                   | Status                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Stored form `{version: 2, decks}` without seat ids; anything else (legacy, garbage, other version) is not a plan                                                                                                     | `seat_plan.rs:39-57`                           | stored the raw plan with ids; accepted any JSON with `decks`  | FIXED (`toStored`/`parseSeatPlan`, `seat-plan.ts:55`); plans the port saved without a version still read, so no saved layout is lost |
| Validation messages (shown to admins): grid size, name length, cell outside, two cells, label 1–10 chars, labels unique (case-insensitive), class ≤ 30, one driver, ≥ 1 seat, ≤ 120 seats                            | `:69-142`                                      | missing label/class length and the 120 cap; different wording | FIXED                                                                                                                                |
| `trusted_plan`, `derive_from_seats` (raw floor order, byte-order labels), `sync_seats` (id then label, window cells, default berth classes, refuse add/remove when in use), `fit_to_seats` (byte-order natural keys) | `:147-410`                                     | OK apart from locale-dependent label sorting                  | FIXED (`localeCompare` → byte order)                                                                                                 |
| In-use refusal message (Vietnamese, count and verb) → 409                                                                                                                                                            | `bus_layouts.rs:377`                           | English text                                                  | FIXED                                                                                                                                |
| `layout_in_use` = trips of the layout's schedules + inventory + sold seats                                                                                                                                           | `seat_plan_db.rs:25`                           | OK                                                            | OK                                                                                                                                   |
| `apply_plan`: deletes first, relabelled seats parked on `~xxxxxxxx`, updates, inserts, layout `total_seats` + stored plan, then fares re-priced                                                                      | `seat_plan_db.rs:51-111`, `bus_layouts.rs:266` | no re-price                                                   | FIXED                                                                                                                                |
| Presets catalog (19 ids, `sleeper_<even 30–50>`)                                                                                                                                                                     | `seat_plan_presets.rs`                         | same data                                                     | OK (Rust's preset tests ported: capacities, decks, WC, cabins, rear benches)                                                         |
| `seat_plan_normalize.rs`, `layout_catalog.rs` (canonical names)                                                                                                                                                      | CLI backfill `backend layouts-normalize`       | n/a                                                           | N/A: operator CLI, no API                                                                                                            |

#### Pure helpers

| Item                                                                                  | Status                                                                                                                                      |
| ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `normalize_phone` (`booking_service.rs:845`)                                          | OK to skip: never called anywhere in Rust (dead code); the port's `normalizePhone` (registration) is a separate behaviour, not audited here |
| `fmt_vnd`, `to_base36`, `brand_prefix`, `gen_booking_code`                            | OK / FIXED (see above), ported tests                                                                                                        |
| `refund_percent`, `departure_instant`, `local_today`, `local_day_start`, `local_date` | FIXED, ported tests (`tests/unit/trip-time.test.ts`)                                                                                        |

#### Error envelope

The port answers `{ "error": { "code", "message" } }`, Rust `{ "error": "<kind>", "message": "<kind>: <text>" }`.
The SPA already reads `error.message` and the mobile app has no booking screens, so only the
**status codes and message text** matter. They now match Rust for every path above (the
`<kind>:` prefix is not reproduced; the coupon codes are exact so `couponErrorCode`'s `endsWith`
works). Not changed here: it is a port-wide decision.

#### Questions (Rust itself looks wrong; nothing here changes money without your word)

- **Q1 VNPay dates.** Rust formats `vnp_CreateDate/ExpireDate` in UTC (`vnpay.rs:78-84`); VNPay
  expects GMT+7, so the order would expire 6 h 45 m before it is created. Mirrored, because VNPay is
  disabled in production. Should dates use Vietnam time?
- **Q2 ZaloPay.** Rust's callback parser expects a flat body and a MAC over the whole raw body
  (cannot match ZaloPay's real `{data, mac}` callback) and stores a random `provider_txn_ref`
  instead of `app_trans_id`, so the callback can never find the payment. The port implements the
  documented protocol and stores `app_trans_id`. OK to keep?
- **Q3 MoMo.** Rust's IPN and create-response structs are snake_case with no `rename`, so MoMo's
  camelCase JSON fails to parse (create always reports "rejected"). The port reads camelCase (and
  snake_case). OK to keep?
- **Q4 Refunds.** A cancelled paid booking reports `refundAmount` but the payment stays `completed`
  (never `refunded`), so the admin "collected" total keeps counting returned money until someone
  patches the payment. Mirrored (the port used to mark `refunded`). Which do you want?
- **Q5 Phone confirmation.** Staff confirming a pay-on-board ticket leaves the cash payment
  `pending` until the driver records the cash (Rust). Mirrored; revenue on the tickets dashboard
  counts the ticket at confirmation, "collected" on the payments page only after the driver.
- **Q6 Provider checked late.** Rust moves the hold and cancels the previous pending payment _before_
  noticing the provider is disabled. The port checks first (invisible on success).
- **Q7 Return URL.** `{base}/payments/{id}/return` has no page in either build (SPA has no such
  route), so a gateway redirect lands on the SPA 404. Not changed.
- **Q8 IPN error reply.** Any non-"not found" failure (including a database error) is answered as
  "Invalid Signature" (97 / code 2 / return_code 3), which tells the gateway to stop retrying
  instead of retrying later. Mirrored.

#### Follow-ups not done here

- ~~`trip-search.ts:506,687`: the weekday mask problem from item 12~~ (done in 5.2: search no longer
  filters existing trips by the schedule's rules, and the inline fill shares `runsOnDate`).
- Tests for the `/ws`-style realtime side of tickets (support chat) are not part of this unit.
- `src/routes/webhooks/*` chat-bot channels (zalo/messenger/telegram/discord) are unrelated to
  payments and still absent (section 1).

### 5.2 Trips, search, recommendations and the public catalog (audited and fixed)

Scope: `src/service/{trip_search,trip_warmer,public_service}.rs` (and the `trip_stops.rs`,
`trip_time.rs`, `fares.rs` parts audited in 5.1), `src/cities.rs` (matching),
`src/store/{route,trip,address,brands}.rs` (the queries search runs), `src/routes/{public,places}.rs`,
`src/middleware/public_cache.rs` (on `master`; the migration branch's `src/` predates it) and the Rust
unit tests inside those files. Port side: `src/lib/services/{trip-search,trip-search-options,
trip-results,trip-cards,trip-geo,trip-recommendations,trip-detail,trip-warmer,public-format,lookups}.ts`,
`src/lib/{city-match,query,public-cache,edge-guard}.ts`, `src/app/api/{trips,search,recommendations,
routes,brands,stats,places}/**`.

**Method.** As in 5.1: every behaviour was read in the Rust source and in the port, then settled by a
workerd test against the real migration chain (`tests/helpers/catalog.ts` is the fixture). Ported 1:1
from Rust: the `cities.rs` matching tests, the `public_service.rs` helper tests (amenities, labels, ISO
stamps, overnight arrival, `on_sale`), the `trip_warmer.rs` tests (VN day roll-over, sell window,
weekday mask, effective window) and the `public_cache.rs` tests; new tests for what Rust implements but
does not test (filters, facets, sort, paging, geo pairs, inline fill, detail, catalog routes). **Honest
limit:** the Rust tests were not executed here (the `rust-sql` submodule is not checked out, so `cargo
test` cannot build); Rust is the specification as read, not as run. Miniflare does not enforce D1's
100-bound-parameter cap, so every id list that can exceed ~90 travels as one JSON parameter (`inList`).

Status key as in 5.1. Line numbers: Rust on `master`/the migration branch's `src/`; "before" is
`feat/cloudflare-migration` at 3c4a61c.

#### Divergences users would have seen (all FIXED)

1. **Coordinate search was a different feature.** The port found the nearest _city_ to each point
   (default 150 km) and ran the city search; Rust matches the _stops_ of each trip (timetable stops with
   their times, else the route's pickup points) within 50 km, picks the nearest pickup and a later
   drop-off, returns them on the card (`pickup`/`dropoff` with distance and time), sorts nearest first by
   default and applies `departAfter` to the time the bus reaches the pickup stop (`public_service.rs:627`,
   `trip_search.rs:208`). Rewritten as `trip-geo.ts`.
2. **Trips were only created by the six-hourly cron.** Rust fills the schedules a search finds missing,
   inline, within a 2 s budget (`public_service.rs:480-549`, `trip_warmer.rs:80,585`). A new schedule, or a
   day the cron had not reached, was invisible in search. Now `fillInline` (single flight per date,
   budgeted, never fails a search) and the cron share `materializeMissing`.
3. **Weekday mask (the open item from 5.1).** `json_array_length('1111100')` is 0, so the SQL filter let
   every schedule through on every day. Rust does not filter existing trips by the schedule at all; it
   uses the mask only when _creating_ trips (`trip_warmer.rs:145`). Now the same, through the shared
   `runsOnDate`/`scheduleRunsOn` (the schedule column comment said "JSON array [1..7]"; fixed).
4. **`GET /api/routes?brand_id=` was ignored.** The port read `brandId`; the SPA and OpenAPI send
   `brand_id` (`routes/public.rs:60`), so every brand dialog listed all routes. It also listed inactive
   routes of a brand, ordered by creation instead of name, gave a brand-less route `brand: null`, and
   accepted `limit` up to 500 for brands (Rust: 200) and treated `0` as 20 (Rust: 1).
5. **`GET /api/places/reverse` returned `{items}`**; the SDK (and `leaflet-map.tsx`) read an array, so the
   map picker named every pin by its coordinates.
6. **`GET /api/stats` published private counters** (`bookings`, `confirmed`, `reviews`, `users`) and
   counted every trip from the UTC date. Rust: `{brands, routes, trips}`, trips = scheduled from today in
   Vietnam (`public_service.rs:1298`).
7. **`GET /api/brands/{slug}` served inactive brands** (`brand_detail` filters `status == "active"`,
   `:320`).
8. **Prices of a trip nobody opened.** The port took `MIN/MAX(schedule_fare.price_adult)`, which ignores
   the base price (standard seats) and fares of classes no seat has. Rust prices every seat class of the
   layout at the schedule's fares (`trip_search.rs:373-384`).
9. **City names.** The port matched only exact names/aliases of its own list. Now Rust's rules
   (`cities.rs:601`): normalised name, slug form or alias, plus containment for queries of 4+ characters
   (`danangairport`, `ben xe my dinh ha noi`), and Rust's alias table (`Phú Quốc`, `Biên Hòa`, …).
   Routes are also found by name (`LOWER(name) LIKE` both sides) with the direction check
   (`runs_between`, `:52`), which the port lacked.
10. **Trip detail** (`public_service.rs:779`): `pickupPoints` fell back to nothing (Rust: the timetable's
    stops), no deck `plan`/`fixtures`/seat `kind`, seats of an unopened trip were not created, `capacity`
    was omitted instead of `null`, the 404 said `Trip not found`, an id that is not a UUID was a 404.
11. **Unreadable query values were silently defaulted** (`?limit=abc` → 20). Rust's typed `Query` answers
    400 (`query.ts`); `date` must be a real calendar date; `hours`/`departAfter` errors carry Rust's text.
12. **Facet order** used `localeCompare` (Rust: byte order), and an unknown amenity was labelled by its key
    (Rust: empty, see Q5).
13. **Cache headers.** None on search, trips, recommendations, places; `s-maxage=30` on four lists.
    Rust: `public, max-age=60` for anonymous callers, `no-store` once a session cookie rides along
    (`public_cache.rs`). The edge Cache API now bypasses signed-in callers too: an admin could otherwise
    read a 30 s stale `/api/brands` right after their own edit.
14. **Warmer details** (`trip_warmer.rs:193-407`): capacity falls back to the vehicle type's
    `total_seats` for layout-less schedules and a schedule with no capacity is skipped (the port made a
    trip with 0 seats); the layout seat count was one query per trip (now one `GROUP BY`; a layout shared
    by many schedules is counted once, the bug master's #92 fixed in Rust); the prune looked at trips
    before _today_ and only `scheduled` ones (Rust: before yesterday, any status) and was one unbounded
    DELETE (now bounded statements, resumable over passes).

#### Behaviour table — city search (`PublicService::search_trips`, `trip_search::results`)

| Behaviour                                                                                                                                   | Rust                                | Status                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Query fields camelCase; `from`, `to`, `date` required; unreadable number/bool → 400                                                         | `dto/public.rs:538`                 | FIXED (`parseSearchOptions`)                                        |
| Validation order: unreadable values, `hours`, `date`, `departAfter`, then empty `from`/`to`                                                 | `routes/public.rs:136`              | FIXED                                                               |
| `limit` default 20 clamp 1..100; `offset` ≥ 0; `minSeats` default 1, floor 1; `priceMin/Max/minRating` ≤ 0 means unset                      | `trip_search.rs:151,98`             | OK / FIXED                                                          |
| `sort`: `price`, `rating`, `departure`; `distance` only in coordinate search; default departure (city) / distance (geo)                     | `:56`                               | OK; `distance` in the city search was accepted, now ignored         |
| `departAfter` `HH:MM`, ≤ 5 chars, 1-digit hour allowed, only the first 2 minute chars read                                                  | `:178,199`                          | FIXED (`minutesOf`)                                                 |
| Routes: active, name path OR (both cities resolved AND endpoints in the sets), cap 1000, then `runs_between`                                | `route.rs:288`, `:52`               | FIXED                                                               |
| Trips of those schedules on the date: `scheduled`, cap **500** before `minSeats`, no ordering                                               | `trip.rs:567`, `:42`                | FIXED (cap order mirrored; truncation is arbitrary in both, see Q8) |
| Existing trips are not filtered by the schedule's window or weekday                                                                         | `:515-549`                          | FIXED                                                               |
| Gap filling: date ≥ VN today, schedules that run that day with no scheduled trip, inline, 2 s budget, single flight, failure never fails    | `:480-549`, `trip_warmer.rs:585`    | FIXED (`fillInline`)                                                |
| Brand status is not checked, route status is                                                                                                | `route.rs:288`                      | FIXED (the port hid inactive brands, see Q4)                        |
| `on_sale`: `scheduled` and `departure_instant` (VN time, recorded departure wins) in the future; unreadable time stays on sale              | `:1336`                             | FIXED (string compare before)                                       |
| `departAfter` against the boarding time (pickup stop time, past midnight when earlier than departure)                                       | `:208`                              | OK                                                                  |
| Card: brand/vehicle type/layout/arrival from batched queries; `minPrice/maxPrice` from seats for sale else layout classes × fares else base | `:297-460`                          | FIXED                                                               |
| Vehicle type labelled from the types the _results_ reference, not the whole catalog                                                         | `:147`                              | FIXED (`resolveVehicleType`)                                        |
| `priceChild` = standard seat for the brand's child policy, 0 without                                                                        | `:1429`                             | OK                                                                  |
| Facets over all matches: price range, brands, vehicle types, 4 hour bands, amenities, plenty of seats; count desc then label (bytes)        | `:467`                              | FIXED                                                               |
| Filters: all must pass; `hours` any band; amenities all                                                                                     | `:235`                              | OK                                                                  |
| Sort: key, then boarding time, then trip id (byte order)                                                                                    | `:529`                              | FIXED (`localeCompare` before)                                      |
| Page: `{items,total,limit,offset,hasMore,facets}`; empty search keeps metadata and empty facets                                             | `dto/public.rs:249-285`             | OK                                                                  |
| 400 texts: `missing departure location (from)`, `missing arrival location (to)`, `date must be YYYY-MM-DD`, `departAfter must be HH:MM`     | `:161,185`, `public_service.rs:562` | FIXED (field order)                                                 |

#### Behaviour table — coordinate search (`search_trips_geo`)

| Behaviour                                                                                                                              | Rust                               | Status                                      |
| -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | ------------------------------------------- |
| Required `fromLat/fromLon/toLat/toLon/date`; `maxDistanceKm` default **50**, clamp 1..200                                              | `routes/public.rs:236,278`, `:634` | FIXED (150, unclamped, nearest city before) |
| Box around each place: `km/111·1.2` lat, `km/(111·cos lat)·1.2` lon (cos floored at 0.01), exact haversine (R 6371) afterwards         | `:84`, `place_service.rs:253`      | FIXED                                       |
| Schedules with a timetable: stops inside either box, nearest pickup + **later** drop-off by total distance, distance rounded to 0.1 km | `:98,637-660`                      | FIXED                                       |
| Schedules without a timetable: their route's pickup points (active routes, lat/lon set) in either box; no time on the stop             | `:662-724`                         | FIXED                                       |
| A schedule with a timetable boards only at its own stops                                                                               | `:716`                             | FIXED                                       |
| Active routes only; cap **1000** trips; same gap filling, filters, facets and paging as the city search                                | `:44,726-766`                      | FIXED                                       |
| Default sort nearest first (pickup + drop-off km), then boarding time, then trip id                                                    | `trip_search.rs:550`               | FIXED                                       |

#### Behaviour table — trips ahead, seats on demand (`trip_warmer.rs`)

| Behaviour                                                                                                           | Rust          | Status                                                                                  |
| ------------------------------------------------------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------- |
| Sell window 14 days from the VN date; past dates never filled; VN day rolls at 17:00 UTC                            | `:68,116,193` | OK (`sellWindow`, `localToday`)                                                         |
| `schedule_runs_on`: effective window then 7-char Monday-first mask; anything else is daily                          | `:145`        | FIXED (+ the port's old JSON-array form is still read, DELIBERATE: existing rows)       |
| Capacity: layout seat count, else vehicle type `total_seats` (layout-less only), else skipped                       | `:282-295`    | FIXED                                                                                   |
| Batched existence check and inserts; idempotent per (schedule, date) via the unique index                           | `:216-338`    | OK (9 rows per INSERT for D1's 100-parameter cap)                                       |
| `ensure_seats` creates a trip's priced seat rows once, on first open or first hold; layout-less schedules have none | `:351`        | OK (hold, 5.1) / FIXED (detail now opens trips too)                                     |
| Boot pass, 6-hourly tick, per-search `notify` to a background task, `TRIP_WARMER_BOOT`                              | `:612-700`    | DELIBERATE: cron tick every 6 h covers the window, the search fills its own date inline |
| Prune unsold seats of trips that left before yesterday; sold and held stay; legacy backfill                         | `:439`        | FIXED (bounded statements per pass instead of Rust's slow date walk)                    |

#### Behaviour table — detail, recommendations, brands, routes, stats, places

| Behaviour                                                                                                                                              | Rust                                                | Status                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/trips/{id}`: 404 `trip not found`/`schedule not found`/`route not found`; non-UUID → 400                                                     | `:779-803`                                          | FIXED                                                                                                                    |
| Pickup points = route points else timetable stops; schedule points with addresses; arrival from the last timed stop                                    | `:846-897,1033`                                     | FIXED                                                                                                                    |
| Seat map by deck → row; status `available` and fare price where no seat row; class fares cheapest first; child prices per seat                         | `:946-1014,1407`                                    | OK                                                                                                                       |
| Saved floor plan trusted only while it matches the seats: deck `plan{name,rows,cols,fixtures}` and seat `kind`                                         | `:932-1014`                                         | FIXED                                                                                                                    |
| `bookable` = `on_sale`; `busLayout.capacity` always present (`null`); `pricing.childFare` only with a policy                                           | `:1059`, `dto/public.rs:373`                        | FIXED                                                                                                                    |
| `GET /api/recommendations`: scheduled, seats left, soonest first, 16 looked at, on-sale ones, first 4; cold database self-heals (7 days, 2 s)          | `:1115-1292`                                        | FIXED (body is `{items}` only; the port added `total`/`facets`)                                                          |
| …on a cold database the home page was empty until the cron ran                                                                                         | `:1130-1158`                                        | FIXED                                                                                                                    |
| `GET /api/brands`: active, best rated first, `routeCount` = active routes, `limit` default 20, ≤ 200 (floor 1)                                         | `:286`, `routes/public.rs:36`                       | FIXED                                                                                                                    |
| `GET /api/brands/{slug}`: 404 `brand not found` unless active                                                                                          | `:320`                                              | FIXED                                                                                                                    |
| `GET /api/routes`: `brand_id`, `limit` (50, 1..500); active only; by name; endpoints from city names, else the name split at `→`; count + lowest price | `:344`                                              | FIXED                                                                                                                    |
| The port's extra `offset` and `q` on `/api/routes`                                                                                                     | —                                                   | FIXED: removed (nothing in the SPA or the OpenAPI sends them)                                                            |
| `GET /api/stats`: `{brands, routes, trips}`                                                                                                            | `:1298`                                             | FIXED                                                                                                                    |
| `GET /api/places`, `/search`, `/reverse`: limits 50/10/10, caps 200/50/50; `q` and `lat`/`lon` required; reverse is a bare array                       | `routes/places.rs`                                  | FIXED                                                                                                                    |
| Place engine: Tantivy index → static shards; `engine` says `static-shards`; blank `q` lists popular places instead of nothing                          | `place_service.rs:120-200`                          | DELIBERATE (index ships with the deploy, 5.0); `/api/places` lists the shipped popular places, not the SQL `place` table |
| Place responses `max-age` 300/3600 instead of 60                                                                                                       | `public_cache.rs` (handlers that set their own win) | DELIBERATE: the index changes weekly, with a deploy                                                                      |

#### Caching: what is cached where

| Read                                                      | Rust                                            | Port now                                                                                                                          |
| --------------------------------------------------------- | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Brand by id/slug/list (moka, 300 s, invalidated on write) | `store/brands.rs:208`, `server.rs:170`          | **Not cached in the app.** `/api/brands` is served from the Workers Cache API (60 s, per colo, free)                              |
| Routes list, stats, search, trips, recommendations        | none in process                                 | Search/trips/detail: no server cache. `/api/routes`, `/api/stats`, `/api/brands`, `/api/recommendations`: Workers Cache API, 60 s |
| Browser/shared HTTP cache                                 | `public, max-age=60`, `no-store` with a session | Same, `publicJson` on every route above; the edge cache never serves or stores a signed-in caller                                 |
| Trip availability, seat maps                              | 60 s browser cache (hold re-validates)          | Same 60 s browser cache, never cached at the edge or in memory                                                                    |

The old tier (per-isolate memory 30–60 s + KV 300 s) was removed for these reads: it served stale
data for up to ~90 s after an admin edit (invalidation reaches one isolate and KV only), cost a KV
`list`+`delete` per admin write, and sat behind the edge cache that already answers the hot paths.
Staleness is now bounded by the 60 s edge TTL for anonymous visitors (what Rust allowed its
browsers) and zero for signed-in staff. The admin write routes no longer call `invalidate*` for
brands, routes and vehicle types (the review-tag cache keeps its own). No KV `list` or `delete` is issued
anywhere in this domain.

#### Questions (Rust itself looks wrong; the port keeps the safer behaviour meanwhile)

- **Q1 Recommendations use the UTC date.** `recommendations()` asks for trips from
  `Utc::now()` (`public_service.rs:1116`) while everything else uses the Vietnam date. Between
  00:00 and 07:00 Vietnam time the first 16 candidates are yesterday's trips, which `on_sale` then
  drops, so the carousel can be empty at night. The port uses the Vietnam date. Keep?
- **Q2 Recommendation cards are simplified.** Rust hard-codes `vehicleType: "standard"`, leaves
  `capacity` empty and prices unopened trips at the base fare (`:1246,1281,1363`), unlike search
  cards for the same trip. The port builds the same card as search. Keep?
- **Q3 Route endpoints carry `lat: 0, lon: 0`** in `GET /api/routes` (`:444-453`); the port sends the
  real city coordinates (a superset). Keep?
- **Q4 Deactivated brands and routes** (decided: better than Rust). Rust search checks the route's
  status but not the brand's, so a deactivated brand stays searchable and bookable; recommendations
  and stats also count inactive routes' trips. The port hides a deactivated brand's trips from search,
  coordinate search and recommendations; inactive _routes_ stay out of search/geo as in Rust. Trips
  are still created for them, so reactivating needs no wait.
- **Q5 Unknown amenity keys** have an empty label in Rust (`amenity_label` → `""`, `:245`); the port
  labels them by their key (decided: better than Rust).
- **Q6 `brand_id` that is not a UUID** is a 500 in Rust (`parse_uuid` surfaced as an internal error);
  the port answers 400.
- **Q7 Unordered truncation.** The city search keeps the first 500 trips of a day and the coordinate
  search 1000, with no `ORDER BY` (`trip.rs:567-598`), so on a day with more the cut is arbitrary.
  Mirrored (an ordering would change which trips are lost, not that some are).
- **Q8 `LOWER(name) LIKE` is ASCII-only in SQLite**, so a route is never found by an
  upper-case-diacritic name (`Đà Nẵng` ≠ `đà nẵng`); only the city-slug path finds it. Mirrored.
- **Q9 Opening a trip writes.** `GET /api/trips/{id}` creates the trip's seat rows
  (`ensure_seats`, `:901`); mirrored (D1 writes ≈ 40 rows once per trip). Prefer to create them only at
  the first hold?
- **Q10 The default `daysOfWeek` of the port's admin schedule form is `"[]"`** (`api/admin/schedules`),
  where Rust stores NULL; both mean daily, and `runsOnDate` reads both. Left for the admin audit.

#### Follow-ups not done here

- `GET /api/routes/{id}/pictures` and the media pipeline (5.5 in the plan).
- The `/sitemap.xml` and SEO routes read trips/routes too; not part of this unit.
- Production D1 should be checked for schedules with a JSON-array `days_of_week` (the port's old
  form) once the admin audit settles the default; until then `runsOnDate` reads both.

### 5.3 Auth, users, RBAC, OAuth, notifications, push (audited and fixed)

Scope: `src/service/{auth_service,users_service,notification_service}.rs`,
`src/routes/{auth,oauth,users,notifications,push_devices}.rs`, `src/auth/*` (jwt, jwt_validator, refresh,
cookies, password, oauth/*), `src/rbac/*`, `src/middleware/{auth_extractor,anti_scraping}.rs`,
`src/error.rs`, `src/validation.rs`, `src/store/{users,refresh_tokens,notification,push_device}.rs` and the
RBAC seed `migrator/.../m20260905_000010_seed_defaults.rs` (+ `m20261011_000020` for the campaigns permission).
Port: `src/lib/auth/**`, `src/lib/services/{users,notifications}.ts`, `src/lib/{api,error-envelope,edge-guard}.ts`,
`src/app/api/{auth,users,notifications,push}/**`.

**Method and honest limit** are those of 5.1: every rule was read in Rust and in the port and then settled by a workerd
test over the real D1 migration chain. The Rust unit tests of these files (`error.rs`, `jwt.rs`, `jwt_validator.rs`,
`password.rs`, `oauth.rs`, `google.rs`, `facebook.rs`, `anti_scraping.rs`) are ported 1:1 into
`tests/unit/error-envelope.test.ts`, `tests/integration/{session,oauth}.test.ts` and `tests/unit/{password,edge-guard}.test.ts`;
`auth_service.rs`, `users_service.rs` and the notification/push stores have no Rust tests, so their rules are pinned by new
tests (`auth-routes`, `users-admin`, `notifications-push`). **The Rust tests were not executed** (the `rust-sql` submodule is not
checked out, so `cargo test` cannot build); Rust is the specification as read, not as run.

Status key as in 5.1. Line numbers are Rust `file:line` on `master`; "before" is `feat/cloudflare-migration` at 29241cf.

#### Divergences worth knowing first (all FIXED unless noted)

1. **`DELETE /api/users/{id}` was open to every employee.** The port only required "staff"; Rust requires `users:delete`
   (admins only, `routes/users.rs:148`). An employee could delete accounts. Now `requirePermission(users:delete)`.
2. **OAuth did not exist.** `start`/`callback` answered 501 and `providers` listed "apple". Google and Facebook sign-in,
   the state cookie, every error redirect and the account link/create are ported (`lib/auth/oauth.ts`, `routes/oauth.rs`).
3. **Password change neither signed other devices out nor issued a session**, and the wrong-current-password message
   ("currentPassword is incorrect") did not match the web client, which recognises it by the words _current password_
   (`password-page.tsx`), so the field error never showed. Now Rust's: 400 "current password is incorrect", every refresh token
   revoked, fresh cookies (`auth_service.rs:244`).
4. **Refresh rotation raced.** Two concurrent refreshes of one token both succeeded (read, then write). Now one conditional
   `UPDATE … WHERE revoked = 0 AND expires_at > now RETURNING user_id`, exactly Rust's `try_revoke_refresh_token`; each failure
   has Rust's own status and text (malformed 400, unknown / expired / mismatch / already used 401).
5. **Logout did not revoke the access token**, ignored ownership of the presented refresh token's session in the fallback and had no
   `all` for a cookie-only caller. Now per-device logout, `all`, and an access-token deny-list (KV; see below).
6. **Mobile sessions got the 7-day refresh lifetime** (Rust: 90 days, `JWT_MOBILE_REFRESH_TTL_SECS`, renewed on each refresh); cookie
   `Max-Age` ignored `JWT_*_TTL_SECS`, `COOKIE_DOMAIN`, `COOKIE_SECURE` and `strict`.
7. **`GET /api/users` reported `total = rows on this page + offset`**, so the admin table's pager was wrong; and the
   notification list paged with another default/maximum and the same wrong total.
8. **Mixed-case emails of imported Rust accounts could not sign in** (the port lower-cased the input and matched exactly).
9. **A second phone-only registration returned 500** (`email` is NOT NULL UNIQUE and both stored `""`).
10. **A malformed percent-escape in a cookie (`%E0%A4%A`) threw `URIError` → 500** in the auth routes; they now read cookies through one tolerant helper (`ws-auth.ts` has the same pattern, see follow-ups).
11. **Errors leaked internals** (`handleRouteError` returned `e.message` of any thrown error, e.g. a D1/SQL message, with status 500).
12. Smaller: `hasPassword` was always `true`; `/me` did not distinguish a missing from an invalid token; `Retry-After` and lockout
    wording; `NullClaw` bot account never created; `admin:campaigns:manage` was missing from the D1 permission seed.

#### Error envelope (decision: Rust shape everywhere, one helper)

Rust answers `{ "error": "<kind>", "message": "<display>" }` (`error.rs:154`, `:138`) where `message` is the thiserror display
(`"unauthorized: invalid credentials"`, `"resource not found: …"`, `"conflict: …"`; every `Forbidden(x)` prints as
`"forbidden: missing permission: x"`; permission failures from the RBAC store print `"store error: forbidden: missing permission: <perm>"`)
and server faults are masked as `"internal server error"`. The port answered `{ "error": { "code", "message" } }`.

**Done:** `lib/error-envelope.ts` is the single place that builds the body (`errorBody`/`errorResponse`). `err()`, `handleRouteError`,
`ApiError`, the edge guard's 403/429, the lockout/rate-limit 429s all go through it, so **no route had to change**: `err(status, code, text)`
derives the Rust kind from `code` (a Rust kind, or one of the port's older names) or from the status. Reasons it was safe: the web
`getErrorMessage` (`spa/lib/error-message.ts:17`) reads `e.error.message` and then `e.message`; the Flutter `ApiClient._extractMessage`
(`mobile/lib/core/net/api_client.dart:336`) reads `message` first, then `error` as a string or `{message}`; nothing in either client reads `error.code`;
`couponErrorCode` matches the _end_ of the message, which Rust's prefix preserves. Tests: `tests/unit/error-envelope.test.ts` (Rust `error.rs` tests ported,
every kind/prefix, masking) plus the route tests below. Consequences to know: messages gained Rust's prefixes (`"conflict: …"`); other domains' tests
that asserted the old `{error:{code}}` shape were updated (`campaigns`, `coupon-lifecycle`, `booking-routes`, `lockout`); the two payment IPN
handlers keep their provider-specific JSON (gateway contracts, not `AppError`). Branches that add old-shape assertions will fail until they use the new body.

#### Behaviour table — register / login / password / session

| Behaviour                                                                                                                                                                                           | Rust                                                                                     | Port before                                                                                   | Status                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Register body: fullName 1–128 chars, email valid ≤255, phone ≤20 + `validate_phone`, password 8–128                                                                                                 | `routes/auth.rs:14-26`, `validation.rs:26`                                               | name ≥2, password ≥8 only, no max, loose email                                                | FIXED `parseRegister` (`auth-routes` test); text is `from_validation_errors`' wording, see below                                                                                                                                                                                  |
| Service re-checks on bytes: name 3–64, password 8–128, email contains `@` ≤254                                                                                                                      | `auth_service.rs:677-700`                                                                | none                                                                                          | FIXED (characters, not bytes: IMPROVED, see Q3)                                                                                                                                                                                                                                   |
| "Email or phone is required"                                                                                                                                                                        | `routes/auth.rs:123-128`                                                                 | 400 `email or phone is required`                                                              | FIXED text                                                                                                                                                                                                                                                                        |
| First HUMAN account → `admin`, bot excluded from the count; later `user`; grants written                                                                                                            | `auth_service.rs:120-198`                                                                | counted every row                                                                             | FIXED                                                                                                                                                                                                                                                                             |
| NullClaw bot (`employee`, `is_bot`, employee grant) created on first signup                                                                                                                         | `auth_service.rs:154-190`                                                                | never created                                                                                 | FIXED (`createBotAccount`); `ensure_bot_account` at boot (`:490`) is N/A on Workers, no boot hook                                                                                                                                                                                 |
| Register auto-logs in, 200, cookies, `tokens` only for `X-Client: mobile` (trim, case-insensitive)                                                                                                  | `routes/auth.rs:114-150`, `auth_service.rs:25-37`                                        | same                                                                                          | OK                                                                                                                                                                                                                                                                                |
| Duplicate email → 409                                                                                                                                                                               | store unique error → `store error: conflict: UNIQUE…` (leaks SQL)                        | 409                                                                                           | DELIBERATE: 409 with `conflict: email already registered`, no SQL                                                                                                                                                                                                                 |
| Phone-only signup                                                                                                                                                                                   | stores the phone in the _email_ column but then fails `validate_email` ("invalid email") | stored; second one 500                                                                        | ASK Q1; port accepts it, keeps phone in `email` **and** `phone`, 409 on a taken phone                                                                                                                                                                                             |
| Login: valid email ≤255, password 1–255; 401 `invalid credentials` for unknown email, no hash or wrong password                                                                                     | `routes/auth.rs:15-36`, `auth_service.rs:204-238`                                        | same status                                                                                   | FIXED limits/text                                                                                                                                                                                                                                                                 |
| Email lookup exact as typed                                                                                                                                                                         | `store/users.rs:204`                                                                     | lower-cased input, exact                                                                      | FIXED: exact first, then an unambiguous case-insensitive match (imported "Ann@x.com")                                                                                                                                                                                             |
| Login by phone, password-guess lockout (5 → 15 min), per-account rate limit                                                                                                                         | not in Rust                                                                              | present                                                                                       | DELIBERATE (port hardening, kept); blocked status now reported only after the password is right                                                                                                                                                                                   |
| Employee login: credentials first (401), then "any role but `user`" from the grants → 403 `This endpoint is for employees only`                                                                     | `routes/auth.rs:233-264`, `auth_service.rs:470`                                          | checked `users.role` before/with grants                                                       | FIXED (grants, fallback to the column only when a user has no grant row)                                                                                                                                                                                                          |
| Argon2id for new hashes                                                                                                                                                                             | `auth/password.rs`                                                                       | PBKDF2-SHA256 100k (Workers' WebCrypto cap), Argon2id imports verified and re-hashed on login | DELIBERATE, unchanged (`needsRehash`; `password.test.ts` ports the Rust hash/verify/fail-closed tests)                                                                                                                                                                            |
| Change password: current required if the account has a password (400, never 401), none needed for social accounts, new 8–128, current ≤255; revokes **all** refresh tokens; fresh session + cookies | `auth_service.rs:244-275`, `routes/auth.rs:198-219`                                      | no revoke, no cookies, wrong message                                                          | FIXED. Fresh session uses the caller's kind (Rust always `Browser`, so the app would drop to 7 days): DELIBERATE                                                                                                                                                                  |
| Refresh: cookie wins over body `refresh_token` (≤4096), none → 401 `missing refresh token`; failures as in item 4                                                                                   | `routes/auth.rs:288-313`, `auth_service.rs:284-405`                                      | one generic 401                                                                               | FIXED. Port also accepts `refreshToken` and a missing body: DELIBERATE leniency                                                                                                                                                                                                   |
| Refresh lifetime 7 d (browser) / 90 d (mobile), renewed on refresh                                                                                                                                  | `auth/refresh.rs:87-110`, `config/mod.rs:171`                                            | 7 d always                                                                                    | FIXED                                                                                                                                                                                                                                                                             |
| Refresh token = `uuid.64hex`, DB stores HMAC-SHA256(secret) keyed by the JWT secret, constant-time compare                                                                                          | `auth/refresh.rs:28-60`, `auth_service.rs:397`                                           | same, non-constant compare in SQL                                                             | FIXED (`timingSafeEqualStr`)                                                                                                                                                                                                                                                      |
| Logout: 204 always; signed in → this device only (refresh + access token), `all` → everything; signed out with a refresh token → that session                                                       | `auth_service.rs:317-377`, `routes/auth.rs:345-398`                                      | refresh only, no `all` without a user                                                         | FIXED. Ownership is enforced **in the UPDATE**; Rust revokes first and only logs when the owner differs (`:345`), so a logged-in user who knew another user's refresh _id_ could revoke it                                                                                        |
| Access-token revocation (per token, per user with `iat <= revoked_at`)                                                                                                                              | in-memory moka, lost on restart (`jwt_validator.rs`)                                     | none                                                                                          | FIXED with KV (`lib/auth/revocation.ts`): shared by all isolates, eventually consistent (≲60 s across locations), no-op without `CACHE_KV`. Tokens carry a random `jti` (not in Rust) because same-second tokens were byte-identical, so logging one device out revoked another's |
| JWT claims `{sub, iss=JWT_ISSUER                                                                                                                                                                    | backend, iat, exp, typ=access}`, HS256 only, leeway 30 s, `exp`required,`sub` a UUID     | `auth/jwt.rs:44-85`                                                                           | fixed issuer, any alg `jose` allows                                                                                                                                                                                                                                               | FIXED (`jwt.rs` tests ported: wrong secret, issuer, leeway, typ, alg) |
| `JWT_SECRET` default `change-me-in-production…`                                                                                                                                                     | `config/mod.rs:178`                                                                      | must be set, ≥16 chars                                                                        | DELIBERATE (never run with a public default)                                                                                                                                                                                                                                      |
| Cookies `access_token`/`refresh_token`: `Path=/; HttpOnly; SameSite`, `Max-Age` = JWT TTLs, optional `Domain`, `Secure` from `COOKIE_SECURE`                                                        | `auth/cookies.rs:25-100`                                                                 | TTLs hard-coded, no Domain/strict                                                             | FIXED. Port adds Secure-on-HTTPS when `COOKIE_SECURE` is unset and the `none; Secure; Partitioned` preview mode: DELIBERATE                                                                                                                                                       |
| Bearer header wins over the cookie; scheme matched case-insensitively                                                                                                                               | `middleware/auth_extractor.rs:35-50`                                                     | same                                                                                          | OK (Rust is case-sensitive on `Bearer`/`bearer`: harmless widening)                                                                                                                                                                                                               |
| 401 texts `missing access token` / `invalid or expired token`; staff gate 403 `staff access required`                                                                                               | `auth_extractor.rs:76-82,167`                                                            | one generic text                                                                              | FIXED                                                                                                                                                                                                                                                                             |
| A deleted user's valid token                                                                                                                                                                        | `/me` → 404 (`store error: entity not found: user …`)                                    | 401                                                                                           | DELIBERATE (401 lets the client refresh/sign out); a non-`active` user is also refused (Rust has no such check)                                                                                                                                                                   |
| `SessionUser` shape; `hasPassword`                                                                                                                                                                  | `auth/session.rs:28-60`                                                                  | `hasPassword` always true                                                                     | FIXED (`brandName` stays null on auth routes like Rust)                                                                                                                                                                                                                           |
| Guest accounts                                                                                                                                                                                      | `is_guest` column only, nothing creates one                                              | n/a                                                                                           | N/A: there is no guest flow in Rust                                                                                                                                                                                                                                               |

#### Behaviour table — OAuth

| Behaviour                                                                                                                                                                                                                                                                                                      | Rust                                                | Port before                             | Status                                                                                           |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Providers `google`, `facebook`; enabled = `OAUTH_<P>_ENABLED=true` (a bool parse) + client id + secret                                                                                                                                                                                                         | `routes/oauth.rs:295-310`, `config/mod.rs:1226`     | listed by client id alone, plus "apple" | FIXED (`oauth.test.ts`: `a_provider_needs_its_switch_and_both_credentials`)                      |
| `GET /providers`                                                                                                                                                                                                                                                                                               | `routes/oauth.rs:329`                               | same shape                              | OK                                                                                               |
| `start`: 404 `oauth provider 'x' not configured`, 500 if `OAUTH_REDIRECT_BASE_URL` empty; 307 to the provider; cookie `oauth_state_<p>` = 32 random bytes base64url, `Path=/; HttpOnly; Max-Age=600; SameSite=Lax; Secure` if cookie-secure                                                                    | `routes/oauth.rs:86-135`, `oauth/mod.rs:106`        | 501                                     | FIXED                                                                                            |
| Authorization URLs (client_id, redirect_uri, state, scope %20-encoded, `response_type=code`, Google `access_type=offline&prompt=consent`), default scopes                                                                                                                                                      | `google.rs:73`, `facebook.rs:70`                    | n/a                                     | FIXED, Rust unit tests ported                                                                    |
| `callback`: provider `error` → redirect with its description; missing code / state / cookie, mismatch (logged as possible CSRF), disabled provider, failed token exchange, failed profile → `{frontend}/login?oauth_error=<urlencoded Vietnamese text>` (relative when `OAUTH_FRONTEND_URL` is empty), all 307 | `routes/oauth.rs:141-300`                           | 501                                     | FIXED, every message pinned                                                                      |
| Google profile with `email_verified=false` is refused (account-takeover guard); Facebook without an email is refused                                                                                                                                                                                           | `google.rs:153`, `facebook.rs:160`                  | n/a                                     | FIXED                                                                                            |
| Success: upsert by `(provider, subject)`, else link by email, else create (verified email, no password, first human → admin); browser session; state cookie cleared; 307 to the frontend                                                                                                                       | `auth_service.rs:431-465`, `store/users.rs:265-362` | n/a                                     | FIXED                                                                                            |
| Linking by email to an existing **password** account                                                                                                                                                                                                                                                           | same                                                | n/a                                     | IMPROVED Q2: an unverified password account is stripped of its password and sessions when linked |
| Outbound calls time out after 10 s                                                                                                                                                                                                                                                                             | `google.rs:56`                                      | n/a                                     | FIXED (`AbortSignal.timeout`)                                                                    |

#### Behaviour table — users, RBAC, notifications, push

| Behaviour                                                                                                                                                                                                                                                                 | Rust                                                             | Port before                                                                      | Status                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/users`: `users:read`; `limit` default 50, max 200 (0 allowed), `offset`; `{items, total}` with the unfiltered total; newest first; empty email omitted                                                                                                          | `routes/users.rs:96-120`, `users_service.rs:25`                  | wrong total, no cap on offset parsing                                            | FIXED. **Staff-only is kept**, and migration `0008` removes `users:read` from the `user` role (in Rust any customer could list every account's email): IMPROVED Q4                                                                |
| `GET /api/users/{id}`: `users:read`; bad UUID 400; unknown 404 `store error: entity not found: user <id>`                                                                                                                                                                 | `routes/users.rs:122-146`                                        | 404 for a bad id                                                                 | FIXED                                                                                                                                                                                                                             |
| `DELETE /api/users/{id}`: `users:delete`                                                                                                                                                                                                                                  | `routes/users.rs:148-166`                                        | any staff                                                                        | FIXED (item 1). Deleting an unknown id succeeds (Rust). 204 as the OpenAPI documents (Rust's handler returns 200 with no body): DELIBERATE. Port refuses deleting oneself or the last human admin (Rust has no guard): DELIBERATE |
| `PATCH /api/users/{id}/role`: role validated first (400 `role must be one of: user, employee, admin`), then `admin:users:manage-roles`; bot → 400 `bot accounts cannot change roles`; last human admin → 409 `cannot demote the last admin — promote another admin first` | `routes/users.rs:180-208`, `users_service.rs:77-131`             | checked `role === admin`, counted bots                                           | FIXED. Column and grant now change in one D1 batch (Rust: two steps) and a demoted staff member's `staff_presence_state` row is removed; **live chat sockets are not closed here** (chat unit)                                    |
| RBAC catalogue and grants (31 seeded + `admin:campaigns:manage`, admin only; employee = all but 7 admin-only; user = posts:read/write, users:read)                                                                                                                        | `m20260905_000010:141-152`, `m20261011_000020:324`               | campaigns permission missing in D1                                               | FIXED: migration `0007` + snapshot; `users-admin.test.ts` pins the whole matrix. Campaign routes still check `isAdmin()` (same outcome)                                                                                           |
| Permission failure                                                                                                                                                                                                                                                        | 403 `store error: forbidden: missing permission: <perm>`         | `Missing permission: <perm>`                                                     | FIXED                                                                                                                                                                                                                             |
| `GET /api/notifications`: `limit` default 20, clamp 1–200, `offset`; `{items, total, unreadCount, limit, offset}`; newest first; own rows only                                                                                                                            | `routes/notifications.rs:34`, `notification_service.rs:29-58`    | default 30, max 100, wrong total                                                 | FIXED                                                                                                                                                                                                                             |
| `POST /api/notifications/read`: empty/missing `ids` → all unread of the caller; else only the caller's named ids; `{ok, updated}` = rows changed                                                                                                                          | `notification_service.rs:62-85`, `store/notification.rs:141-170` | same, but silently truncated ids at 500 and treated malformed JSON as "mark all" | FIXED: ids must be UUIDs, malformed JSON is a 400, more than 500 ids is a 400 (D1 binds 100 parameters per statement, so ids go in chunks; Rust has no limit): DELIBERATE                                                         |
| `POST /api/push/devices`: trim token, empty → 400 `token cannot be empty`, >4096 → 400 `store error: validation error: invalid push token`, platform `ios`/`web`/else `android`, upsert, `{ok, pushEnabled}`                                                              | `routes/push_devices.rs:37-71`, `store/push_device.rs:91-127`    | `last_seen_at` set on insert, other message                                      | FIXED. `updated_at` is NOT NULL in D1 (nullable in Rust), so a new row carries its creation time there                                                                                                                            |
| `DELETE /api/push/devices/{token}` scoped to the owner, `{ok, deleted}`                                                                                                                                                                                                   | `routes/push_devices.rs:73`                                      | `decodeURIComponent` threw on a stray `%`                                        | FIXED                                                                                                                                                                                                                             |

#### Edge guard vs `anti_scraping.rs`

| Rule                                                                                                           | Rust                                                                          | Port                                                                                                 | Status                                                                                                       |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Mutations (POST/PATCH/PUT/DELETE) on `/api/*` need Referer or Origin that matches an allowed origin            | `anti_scraping.rs:191-225`                                                    | `enforceOrigin`                                                                                      | OK; 403 body now the Rust envelope (`forbidden: missing permission: Access denied: invalid request origin.`) |
| Matching                                                                                                       | `referer.starts_with(origin)` (`:86`): `https://datxevui.com.evil.net` passes | host comparison (`originAllowed`)                                                                    | DELIBERATE (stricter, tested)                                                                                |
| Header preference                                                                                              | `Referer`, else `Origin`                                                      | `Origin`, else `Referer`                                                                             | DELIBERATE (browsers send both from the same page)                                                           |
| Exemptions: path contains `/ipn/` or `/vitals`, `X-Client: mobile` (trimmed, case-insensitive)                 | `:202`                                                                        | `/api/payments/ipn/`, `/api/vitals`, mobile; also `/api/jobs/tick` (bearer-token authenticated cron) | OK / DELIBERATE extra                                                                                        |
| `/health`, `/ready` exempt from everything                                                                     | `:147`                                                                        | `isExempt` (also `/api/health`, sitemap, robots: reads only)                                         | OK                                                                                                           |
| User-Agent blocklist (curl, wget, python-requests, headless…, empty UA) and "non-browser UA on `/api/*` → 403" | `:42-135`, `:228-247`                                                         | not ported                                                                                           | ASK Q5                                                                                                       |
| Global per-IP limit 600 rpm / burst 100, answered as plain text `Too Many Requests! Wait for Ns`               | `routes/router.rs:100-125`                                                    | Workers rate-limit bindings per IP and class (`edge-guard.ts`), JSON 429 + `Retry-After`             | DELIBERATE (different mechanism, same intent; both clients ignore the body of a 429)                         |

#### Questions and how they were settled

You allowed the port to be better than Rust, so the cases where Rust looks wrong were resolved in the safer direction
(status **IMPROVED**), with a test each. Only Q1 and Q5 remain open.

- **Q1 Phone-only registration (ASK, port keeps its behaviour).** Rust copies the phone into the email slot and then rejects it
  with "invalid email", so the web form's phone-only path can never succeed. The port accepts it (phone kept in `email` _and_
  `phone`, 409 on a taken phone) and offers phone sign-in. Say if you would rather refuse phone-only accounts.
- **Q2 Pre-account takeover through OAuth (IMPROVED).** Rust links a Google/Facebook identity to the account with the same email, and
  never verifies emails at registration, so someone could register `victim@x.com` with their own password and keep access after the
  victim signs in with Google. Now, when the account has a password and `email_verified_at` is empty, linking clears the password,
  revokes every refresh token and marks the email verified (the provider just verified it for the person at the door); the owner
  sets a new password from the account page, which then asks for no current one. A verified account links as before.
  Trade-off: a genuine customer who registered with a password and later uses Google for the first time must set a password again.
- **Q3 Name length (IMPROVED).** Counted in characters, not bytes: a 22-letter Vietnamese name no longer fails "3-64 characters".
- **Q4 Customers could list every user (IMPROVED).** `users:read` is removed from the `user` role (migration `0008`; `USER_PERMS`
  in `rbac.ts`), on top of the staff gate on both routes. Employees and admins keep it.
- **Q5 User-Agent blocklist (ASK, not ported).** It is bypassed by one header, and rule 3 (any non-browser UA on `/api/*` → 403)
  would also reject payment-gateway IPNs and the cron tick, whose UAs are not browsers (Rust exempts IPNs only from the _Referer_
  check). Prefer Cloudflare Bot Fight / WAF rules. It is a pure function (~40 lines) if you want it in the Worker anyway.
- **Q6 Logout across users (IMPROVED).** Rust revokes the presented refresh token _before_ comparing its owner and only logs
  `not revoked` (`auth_service.rs:339-353`). The port pins the owner in the UPDATE.
- **Q7 Validation text (IMPROVED).** Rust's login/register/password handlers return `validator`'s raw `Display`; the port uses the
  readable `from_validation_errors` wording (status unchanged: 400).
- **Q8 Mobile password change (IMPROVED).** Rust issues the post-change session as `Browser` even for the app (7 days instead of
  90); the port keeps the caller's kind.
- **Also improved, no question needed:** the first human account is chosen _inside the INSERT_, so two simultaneous first signups
  cannot both become admin (Rust counts, then inserts), and the NullClaw bot is created whichever way the first human arrives
  (password or OAuth); an unknown email now spends the same verification time as a wrong password, so response time no longer
  reveals which emails have accounts.

#### Follow-ups not done here

- WebSocket auth (`lib/realtime/ws-auth.ts`, chat unit) verifies the JWT itself and does **not** consult the access-token
  deny-list, so a token revoked by logout still opens a socket until it expires. `isAccessTokenRevoked(token, claims)` is
  ready for it; it needs the KV binding passed into the Durable Object.
- `ws-auth.ts` still runs `decodeURIComponent` on the cookie without a guard (a malformed escape fails the upgrade).
- Closing a demoted user's live chat/call sockets (Rust `presence().remove`) belongs with the chat unit; only the D1 row is removed here.
- The account lockout (429) still reveals that a locked email exists; that is the price of an exact guessing bound.
- `ensure_bot_account()` at boot (self-healing of a pre-three-role bot row) has no Workers equivalent; migrated data should be checked once.

## 6. Production-readiness pass (2026-10-28)

A cross-cutting read of the whole `cloudflare/` tree (routes, shared helpers, config, dependencies,
CI), separate from the per-domain audits above.

### Fixed

1. **Three reads answered anonymous callers; Rust guards all of them.**
   `GET /api/nullclaw/exchanges` returned customers' chat prompts and AI replies (phone numbers,
   booking codes, travel plans; Rust needs `admin:nullclaw:read`, `routes/nullclaw.rs:40`),
   `GET /api/chat/channels/online` returned customer ids and their open channels (staff only,
   brand-scoped, `routes/chat.rs:180`), `GET /api/presence/staff` returned the staff roster
   (`routes/presence.rs:36`). Now 401 for anonymous, 403 for customers (and for employees on the
   audit log), covered by `tests/integration/staff-only-routes.test.ts`. `GET /api/nullclaw/status`
   stays public like Rust. **Everything that was reachable before the fix should be assumed read by
   a crawler**: if the assistant was ever enabled, review the `nullclaw_exchange` table's exposure.
2. **500 responses leaked internals.** `handleRouteError` echoed the exception text (SQL, gateway
   response bodies from `payment.ts`). Rust answers `internal server error` and logs the detail
   (`error.rs:134`). Now the same; 4xx and 503 keep their messages (`tests/unit/api-errors.test.ts`).
3. **Staff check written six ways.** `isStaff(user)` from `lib/auth/rbac.ts` is now the only
   definition in the routes and services; the chat queue filter is one function
   (`staffQueueWhere`) shared by the channel list and the online list.
4. **Dependencies.** 39 packages that nothing imports (all `@radix-ui/*` but three, `@dnd-kit/*`,
   `@mdxeditor/editor`, `recharts`, `framer-motion`, `next-auth`, `next-intl`, `react-markdown`,
   `react-syntax-highlighter`, `cmdk`, `embla-carousel-react`, `@reactuses/core`,
   `tailwindcss-animate`, `z-ai-web-dev-sdk`, `eslint-plugin-prettier`) were removed; `next build`
   and `opennextjs-cloudflare build` still succeed. Fewer packages to patch and audit.
5. **Lint is now a gate.** 58 warnings cleared (`useWatch` instead of `watch`, no state-setting
   effects, no non-null assertions, `<img>` rule switched off because `images.unoptimized` is set),
   and CI runs `eslint --max-warnings 0`.

### Open, deliberately not changed here

- **Error envelope.** Settled in section 5.3: every error now has the Rust shape
  `{ "error": "<kind>", "message": "<kind>: <text>" }`, built in one place (`lib/error-envelope.ts`).
- **Other users of `window.console` patching** (`spa/lib/console-protection.ts`) and the
  `VeXeVN` banner text are carried over from the Rust frontend as is.
- **D1 placement.** If latency to D1 dominates, `placement.mode = "smart"` in `wrangler.jsonc` and
  D1 read replication are one-line experiments; measure before enabling.
- **Workers Logs volume.** `observability.enabled` logs every invocation; set
  `head_sampling_rate` once traffic grows.
