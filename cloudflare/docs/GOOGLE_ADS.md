# Google Ads & GA4 — measurement setup

This is the Next.js/Cloudflare port of the old Vite build's prerender-time
gtag injection. The runtime helpers (page views, conversions, click-id
capture) live in `src/spa/lib/analytics.ts` and are unchanged; only the
injection point moved — from `prerender.mjs` writing `<script>` tags into
`index.html` to `src/app/google-measurement.tsx` rendered from the root
layout.

## Environment variables (build time)

| Variable                             | Purpose                            | Example                                                    |
| ------------------------------------ | ---------------------------------- | ---------------------------------------------------------- |
| `NEXT_PUBLIC_GA4_ID`                 | GA4 measurement id                 | `G-ABC123XYZ`                                              |
| `NEXT_PUBLIC_GOOGLE_ADS_ID`          | Google Ads conversion account      | `AW-123456789`                                             |
| `NEXT_PUBLIC_GOOGLE_ADS_CONVERSIONS` | JSON map: event → conversion label | `{"booking":"AW-123/AbC_123","purchase":"AW-123/DeF_456"}` |

All three are optional and public (never secrets). Unset ⇒ no script is
injected and every helper no-ops — exactly the old behavior with unset
`VITE_*` vars. The `NEXT_PUBLIC_` prefix makes Next.js inline them into the
client bundle at build time, so they must be present in the environment
that runs `opennextjs-cloudflare build`:

```sh
# local build
NEXT_PUBLIC_GA4_ID=G-… NEXT_PUBLIC_GOOGLE_ADS_ID=AW-… \
NEXT_PUBLIC_GOOGLE_ADS_CONVERSIONS='{"booking":"AW-…/…"}' \
bun run deploy
```

In CI set them as repository secrets → build-time environment variables.

## What fires when configured

- **`page_view`** on every SPA route change (`RouteMeta`, also keeps
  `<title>`/description/robots in sync; private routes are excluded).
- **`conversion`** events at the money moments: `booking` (hold confirmed)
  and `purchase` (payment completed), each with value/currency/transaction id.
- **Click-id capture** (`gclid`/`wbraid`/`gbraid`) on the first landing
  before the SPA router rewrites the URL, replayed into conversion events
  and mirrored to `POST /api/ads/conversions` via `navigator.sendBeacon`
  (stored in `ad_conversion`). When the `GOOGLE_ADS_*` secrets
  (`DEVELOPER_TOKEN`, `CUSTOMER_ID`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN`,
  `CONVERSION_ACTIONS` as a JSON map event → conversion action; optional
  `LOGIN_CUSTOMER_ID`) are all set, a conversion that carries a click id is also
  uploaded to the Google Ads API after the beacon is answered. Without them the row
  is stored as `unconfigured`.

## ads.txt

`public/ads.txt` ships as a documented placeholder (IAB spec). When the
AdSense/Ad Manager account is approved, put the real `pub-…` line there
and redeploy — it is served at `https://datxevui.com/ads.txt`.

## Verification

```sh
# build with a throwaway id, then check the served HTML contains gtag
NEXT_PUBLIC_GA4_ID=G-TEST bun run build && bun run start
curl -s localhost:3000 | grep -o 'googletagmanager.com/gtag/js?id=G-TEST'
```
