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

1. Bookings and seat holds: `booking_service.rs` (1,555 lines), `seat_plan*.rs`, `fares.rs`, hold
   expiry, ticket lifecycle and phone-confirm flow.
2. Payments: `payment_service.rs` (1,322), IPN verification and idempotency, COD, refunds.
3. Trips and search: `trip_search.rs`, `trip_warmer.rs`, `trip_stops.rs`, `public_service.rs`
   (1,558), recommendations, facets.
4. Auth and users: `auth_service.rs`, RBAC, OAuth, guest accounts, notifications.
5. Chat, reviews, loyalty, price alerts, posts, ads, jobs/scheduler, route media pipeline
   (`route_media_service.rs`, 697 lines: thumbnails, content-addressed keys).

Method for each: list Rust behaviours (including error codes and status transitions), port the
Rust unit tests as workerd tests against the same fixtures, and fix what fails. The campaign
section above is the template.
