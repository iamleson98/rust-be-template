# Google Ads Integration Guide

How this codebase supports running Google Ads campaigns: landing-page
quality, click-id attribution, and conversion tracking. Everything is
build-time configured by env vars — no code changes are needed to go
live, and nothing breaks when the vars are unset.

## Landing page readiness (already in place)

Google Ads scores landing pages on speed, mobile experience, and
content match. The frontend already ships the levers that matter:

- **Fast first paint** — the homepage is prerendered to static HTML
  (`frontend/prerender.mjs`) and served pre-gzipped/brotli'd by the
  Rust backend; the hero image is AVIF with `fetchpriority="high"`.
- **Mobile-first responsive layout** across all user-facing pages.
- **Complete meta/SEO head** — title, description, canonical, Open
  Graph and Twitter cards in `frontend/index.html`, per-route titles
  via `RouteMeta`, JSON-LD structured data, `robots.txt` + sitemap
  endpoints served by the backend.
- **Web-vitals RUM** — LCP/INP/CLS/TTFB/FCP are beamed to
  `/api/vitals`, so regressions that would hurt Ad Rank are visible
  in production data, not just lab tests.

## Conversion tracking

### The two conversion events

| Event      | Business moment                                  | Fired from                                 | Value sent                |
| ---------- | ------------------------------------------------ | ------------------------------------------ | ------------------------- |
| `booking`  | Booking confirmed (seat held+paid method chosen) | `features/booking/flow/booking-dialog.tsx` | booking total, VND        |
| `purchase` | Payment completed (gateway says paid)            | `routes/booking-detail.tsx` (`handlePaid`) | payment amount + currency |

Both flow through `trackConversion()` in `frontend/src/lib/analytics.ts`.
Google Ads dedupes conversions by `transaction_id` (the booking code),
so a repeated fire collapses to one recorded conversion.

### Enabling (production build)

Set these when building the frontend (see `frontend/.env.example`):

```sh
VITE_GA4_ID=G-XXXXXXXXXX            # optional, GA4 measurement
VITE_GOOGLE_ADS_ID=AW-XXXXXXXXX     # the Google Ads tag
VITE_GOOGLE_ADS_CONVERSIONS='{"booking":"AW-XXXXXXXXX/AbC-123","purchase":"AW-XXXXXXXXX/DeF-456"}'
```

`prerender.mjs` injects one shared `gtag.js` script, one `config` line
per configured tag ID, and the conversion-label map as
`window.__GOOGLE_ADS_CONVERSIONS__` into `dist/index.html`. In Google
Ads UI: **Goals → Conversions → New conversion action → Website**, then
copy each action's `send_to` label (`AW-…/label`) into the map above.

In dev (or an untagged build) every `trackConversion()` call is a safe
no-op; the reason is logged via `console.debug` in dev mode only.

## Click-id attribution (`gclid` / `wbraid` / `gbraid`)

Ads auto-tagging appends the click id to the landing URL
(`https://datxevui.com/?gclid=EAIa…`). An SPA would normally lose it the
moment the router rewrites the URL, so `entry-client.tsx` calls
`captureClickIds()` before the app renders:

- ids are read from the landing URL and persisted to `localStorage`
  (`datxevui:ads-click-ids`) with a 90-day TTL — Google's maximum
  click-conversion attribution window;
- a later paid landing **overwrites** the stored ids (most-recent-click
  wins, mirroring gtag's own model); internal navigations without ids
  keep the previous capture;
- `getClickIds()` feeds the server-side conversion recording below.

## Server-side conversion recording (the durable half)

`trackConversion()` now does BOTH of these, fire-and-forget:

1. the gtag dispatch (above), and
2. a `navigator.sendBeacon` to `POST /api/ads/conversions` carrying
   the event, transaction id, value, currency and the stored click
   ids.

The backend persists every beacon in the first-party `ad_conversion`
table — deduped by `(event, transaction_id)`, so browser retries and
double-fires collapse. Beaconing is **independent of any Ads
configuration**: records accumulate from day one, and enabling
credentials later loses nothing (see the sweep below).

Row status lifecycle:

| status         | meaning                                                  |
| -------------- | -------------------------------------------------------- |
| `pending`      | stored, upload about to run (or attempted asynchronously) |
| `uploaded`     | accepted by the Google Ads API                            |
| `error`        | API rejected it — retried by the next sweep               |
| `unconfigured` | stored while credentials were off — backfillable          |
| `skipped`      | no click id on the record (organic conversion)             |

### Enabling server-side uploads (production backend)

Set the `GOOGLE_ADS_*` group in the backend env (see `.env.example`):
developer token, customer id, OAuth client + secret, an offline-access
refresh token for the `adwords` scope, and the
`GOOGLE_ADS_CONVERSION_ACTIONS` map from event name to conversion
action resource name (`customers/{cid}/conversionActions/{id}` — the
resource names, not the gtag labels). With the group set, each new
record uploads via `customers/{cid}:uploadClickConversions`
immediately after the beacon lands; OAuth access tokens are minted
from the refresh token and cached in-process.

Backfill the backlog (rows stored before the credentials existed, plus
`error` rows) any time:

```sh
cargo run -p backend -- ads-sweep [--limit 500]
```

The endpoint is `MaybeAuthUser` on purpose: the beacon fires seconds
after the money moment, and an expired session must not lose a
measurement record that carries no PII.

## Testing

- Unit (frontend): `frontend/src/lib/__tests__/analytics.test.ts`
  covers the conversion dispatch (configured / unconfigured / partial
  payload), the beacon (URL, JSON body shape, no-throw on quota
  errors, fires even unconfigured) and the click-id lifecycle
  (capture, overwrite, TTL, corruption).
- Unit (backend): `src/ads/mod.rs` tests the conversion-datetime
  normalisation Google's API requires.
- Manual: build with the env vars above, land on
  `/?gclid=test&wbraid=01a…`, complete a booking → payment, then check
  the `conversion` events in the Google Ads **Conversions → diagnose
  tag** or in GA4 DebugView; with the server-side group configured,
  also inspect the `ad_conversion` table (`status = 'uploaded'`).
