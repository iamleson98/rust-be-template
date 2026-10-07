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
(`https://datxevui.vn/?gclid=EAIa…`). An SPA would normally lose it the
moment the router rewrites the URL, so `entry-client.tsx` calls
`captureClickIds()` before the app renders:

- ids are read from the landing URL and persisted to `localStorage`
  (`datxevui:ads-click-ids`) with a 90-day TTL — Google's maximum
  click-conversion attribution window;
- a later paid landing **overwrites** the stored ids (most-recent-click
  wins, mirroring gtag's own model); internal navigations without ids
  keep the previous capture;
- `getClickIds()` exposes the stored ids for a future server-side
  conversion upload through the Google Ads API (offline conversions,
  enhanced conversions). No backend endpoint consumes them yet — that
  integration is deliberately deferred until Ads is actually live.

## Testing

- Unit: `frontend/src/lib/__tests__/analytics.test.ts` covers the
  conversion dispatch (configured / unconfigured / partial payload)
  and the click-id lifecycle (capture, overwrite, TTL, corruption).
- Manual: build with the env vars above, land on
  `/?gclid=test&wbraid=01a…`, complete a booking → payment, then check
  the `conversion` events in the Google Ads **Conversions → diagnose
  tag** or in GA4 DebugView.
