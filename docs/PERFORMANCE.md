# Speed and crawlability of the public pages

Owner requirement: the public pages (home, search and its corridors, brands,
privacy, terms) load very fast and are readable by search engines that do not
run scripts. This page records what was measured, what changed and what still
misses the targets.

## What was wrong (live site, 2026-11-16)

* The HTML of `/` held 95 visible characters, no `<h1>`, an empty `#root` and
  27 `modulepreload` links. Crawlers that do not run scripts saw nothing.
* Every HTML hit travelled Cloudflare -> tunnel -> VPS (Singapore):
  `cf-cache-status: DYNAMIC`, `cache-control: no-cache, must-revalidate`,
  TTFB 180-215 ms from Vietnam.
* The first paint waited for the app: 98 requests (79 scripts) on `/`, the
  hero image was the largest paint and was requested by a script that had to
  run first (and, on a phone, preloaded the 104 KB desktop file and then
  fetched a 137 KB one).
* `vite-plugin-compression` never produced `.br` files, so the server sent
  gzip; `stats.html` (1.5 MB) shipped in `dist/`.

## What changed

**Server (`src/web/`, `src/middleware/edge_cache.rs`)**

* The text of each public page is written into `<div id="root">` (the app's
  `createRoot().render` replaces it on mount: no hydration, nothing to
  mismatch). Home: one `<h1>`, a working search form (`<form action="/search"
  method="get">` with `from`, `to`, `date`: it submits before the app has
  started and lands on a page the edge keeps), the promises, links to the
  popular corridors (`/search?from=..&to=..`) and the brands, the next
  departures. Brand
  pages: name, description, rating and phone where they exist, every route
  with its lowest fare and departure times, locations, the trips of the next
  three days. Corridor pages: `Xe tu A di B`, today's and tomorrow's trips
  with times, prices, seats, links to the trip and the brand. `/search`,
  `/compare`: a headline, the form and the corridors. A corridor is named one
  way in its head, canonical URL, heading and breadcrumb (`ha-noi` and `hà nội`
  become `Hà Nội`; an alias such as `Sài Gòn` stays as typed) and cached by the
  pair of city slugs, never by the typed text; a search between names the
  catalogue does not know, or that name several cities, is served (200, the app
  answers it) as `noindex`, with no canonical, no text and no edge caching. All from the same service calls
  as the JSON API, cached in process for five minutes; everything from the
  database or the URL is HTML-escaped; a missing figure is left out.
* Head: `hreflang` (`vi`, `x-default`; the language is not in the URL),
  `BreadcrumbList` on brand and corridor pages, `ItemList` of routes (not of trips: their
  pages are `noindex`), home hero preload per screen size. The sitemap dates a brand or a
  corridor by its `updated_at` and leaves the pages the catalogue cannot date
  undated.
* The home page embeds the data its first screen would fetch (routes, brands,
  stats, next departures) as JSON; the app puts it in the TanStack Query cache
  before it renders (four requests fewer, no skeletons).
* Public pages answer `public, max-age=0, s-maxage=300,
  stale-while-revalidate=3600, stale-if-error=86400` with a weak `ETag` and
  `304`s; private pages, 404s, unknown-city searches and degraded pages stay
  `no-cache`; a cacheable response that sets a cookie is rewritten to
  `no-store`; `Vary` is `Accept-Encoding` only and no `Access-Control-Allow-*`
  header is on a cacheable page. `deploy/vps/update.sh` carries the hashed
  assets of the last three releases (and every release younger than 48 h) into
  each new one, so a page the edge still holds finds its files
  (`deploy/vps/test-update-assets.sh`).
  `Link: rel=preload` headers (fonts, stylesheet, hero) feed Early Hints. The
  Cloudflare rule to create is in `deploy/vps/README.md`.

**Build and app (`frontend/`)**

* The app starts the ordinary way: a `<script type="module">` (with
  `fetchpriority="low"`: the page is complete and usable without it, so the
  styles, fonts and hero photo come first) and the `modulepreload` links of its
  three shared chunks. A boot script of a few lines in `<head>` also starts it
  at once on the first `pointerdown`, `focusin`, `keydown` or `touchstart`, and
  keeps the Google Ads click ids (`gclid`, `wbraid`, `gbraid`) of the landing
  URL, so a visitor who leaves through a server-written link before the app
  has started is still attributed. When the app mounts it carries over whatever
  was typed into the server's form.
* Chunks follow what a first visit needs (`vite.config.ts`): React and the
  entry's static imports are three cacheable files; the rest is grouped by
  library instead of one chunk per library that every page downloaded whole.
  Admin and account shells are lazy; the home sections are one chunk.
* Brotli (and gzip) twins of every compressible file
  (`scripts/precompress.mjs`); the server prefers `.br`.
* The search form validates with a hand-written resolver (no zod), the
  calendar and time columns load when the date field opens, the header's two
  menus (Base UI menu code) load when idle or when reached for, the admin
  console's strings (a third of each dictionary) load with the console, the
  day label and date parsing use no date library. Service worker, web vitals,
  console protection and the Google tags start when idle.
* Fonts: only the three subsets the site needs, inlined as CSS, the two
  files the first text needs preloaded; italic and Cyrillic files removed.
  Hero: a 23 KB AVIF for phones, the 104 KB one for wider screens, WebP and
  JPEG fallbacks.

## Before and after

Lighthouse 13.6, mobile, `--preset=perf --throttling-method=simulate`, Chrome
via `CHROME_PATH`, performance and SEO categories. "Before" is the live site,
median of 3 runs. "After" is this branch's debug build serving `frontend/dist`
on localhost with a demo database of 20 brands and 10 corridors, median of 5
runs: the same simulated throttling, but no real network, and without the
Cloudflare cache rule (which only helps further). "Requests before LCP" counts
requests that started before the observed LCP (on localhost that is nearly
all of the scripts, which is what the simulation then charges to the paint).

| Page | | Perf | SEO | FCP | LCP | TBT | CLS | Requests (before LCP) | JS transferred |
|---|---|---|---|---|---|---|---|---|---|
| `/` | before | 78 | 100 | 979 ms | 5479 ms | 135 ms | 0 | 103 (96) | 482 KB / 79 files |
| `/` | after | 85 | 100 | 635 ms | 4297 ms | 79 ms | 0 | 63 (58) | 324 KB / 45 files |
| `/search?from=ha-noi&to=hai-phong` | before | 85 | 100 | 974 ms | 4274 ms | 46 ms | 0 | 90 (90) | 474 KB / 72 files |
| | after | 92 | 100 | 633 ms | 3337 ms | 13 ms | 0 | 61 (38) | 324 KB / 44 files |
| `/brands/a-ba` | before | 92 | 100 | 970 ms | 3370 ms | 32 ms | 0 | 77 (70) | 410 KB / 60 files |
| | after | 100 | 100 | 630 ms | 630 ms | 0 ms | 0 | 55 (34) | 334 KB / 40 files |
| `/privacy` | before | 94 | 100 | 1143 ms | 3003 ms | 10 ms | 0 | 60 (52) | 357 KB / 44 files |
| | after | 96 | 100 | 630 ms | 2845 ms | 0 ms | 0 | 38 (28) | 274 KB / 24 files |

**These are lab numbers from a local debug build.** The app's scripts start
with the page, as they should, so in Lighthouse's simulation they share the
simulated 1.6 Mbit/s link with the hero photo and the styles: the largest
paint is then estimated at 3-4 s even though the server's HTML paints it
(observed) in about 130 ms on localhost. An earlier revision started the
scripts 250 ms after `load`; it scored 100 and 0.6-1.6 s everywhere, but it
delayed the app (the search card did not work until then) and the ad click
ids, and was dropped as measuring the scheduling, not the page. Variants of
the start tried on `/` and the brand page, three runs each, LCP: modulepreload
links only 4.2 / 4.4 s; no preload 4.6 / 4.7 s; `fetchpriority=low` script and
links 4.2 / 4.3 s (kept). The brand page measures 100 at the median of five
but 85 in some runs: Lantern's estimate depends on whether the app's own
render paints a larger block of text than the server's.

(JS transferred is everything the page loads until the trace ends, including
what loads when idle: web vitals, the header menus, footer, chat and call
widgets. Compression: before, what Cloudflare negotiated with the old gzip
files; after, Brotli.)

HTML (home, Brotli / raw): before 3.3 KB / 10 KB, 95 visible characters, no
`<h1>`, 0 links; after 9.2 KB / 42 KB, 1322 visible characters, one `<h1>`,
32 links, 17 KB of that the embedded JSON. A brand page: 2.6 KB / 8 KB
before, 5.6 KB / 26 KB after.

### Size of each chunk (bytes, KB)

What the entry loads:

| Chunk | Raw | gzip | Brotli |
|---|---|---|---|
| `vendor-react` (react, react-dom, scheduler) | 213.6 | 66.1 | 56.7 |
| `vendor` (router, query, Base UI parts the shell uses, sonner, tailwind-merge) | 167.6 | 53.9 | 47.8 |
| `index` (app shell, router, stores, API client, i18n core) | 164.5 | 47.1 | 40.1 |
| `rolldown-runtime` | 0.7 | 0.7 | 0.7 |
| **Initial JS** | **546.4** | **167.8** | **145.2** |
| `index-*.css` (all pages) | 204 | 31 | 24 |

Added by the home route (loaded when it mounts): `vendor-base-ui` 63.5 br
(popover, tooltip, dialog, combobox of the search form), `vendor-form` (react-hook-form)
12.4, `vendor-icons` 9.3, `route-card` 7.9, `home-page` 4.4, `ui` 4.0.
Loaded when idle: `vendor-base-ui-menu` + `header-menus` 15.5, web vitals,
console protection. Loaded on use: `trip-date-panel` + `vendor-date` 20.4
(calendar), `vendor-schema` (zod, 22.6, booking and auth forms only),
`vendor-leaflet` 37.9 (maps), `vi-admin` 11.3 (console), `en` 18.9 (English).

## Against the targets

| Target | Result (lab, local debug build) |
|---|---|
| mobile Performance >= 90 | brand 100, search 92, privacy 96; **home 85** |
| LCP <= 2.0 s | brand 0.63 s; **home 4.3 s, search 3.3 s, privacy 2.8 s** (simulated, see above) |
| TBT <= 150 ms | 0-79 ms |
| CLS <= 0.05 | 0 |
| SEO 100 | 100 |
| <= 20 requests before LCP | **no**: 34-58 started before the observed LCP on localhost (all pages) |
| home CSS <= 60 KB compressed | 24 KB Brotli (31 KB gzip) |
| initial JS on the home route <= 200 KB compressed | 145 KB Brotli for the entry; **about 260 KB** with the route's own chunks |

### What still misses, and why

* **Home LCP and score.** What the server sends paints in well under a second;
  Lighthouse's estimate adds the bandwidth the app's 145 KB (plus 180 KB of
  route chunks) takes on its simulated link, because the scripts start with the
  page. The remedy is less JS, not later JS: the home route's search form pulls
  Base UI's floating-ui stack (about 64 KB Brotli) and react-hook-form (12 KB).
  Replacing them changes behaviour, so it was not done.
* **Requests before LCP** is a localhost artifact as well as a real count: the
  browser issues the scripts, the modulepreload links, the fonts and the hero
  at parse time, as it should.
* **Home route JS is about 260 KB Brotli, not 200.** See above.
* **The after numbers are local**, from a debug build, with simulated network.
  The live site cannot show them until this branch is deployed and the
  Cloudflare cache rule exists (`deploy/vps/README.md`); the real TTFB gain
  (180-215 ms -> a Vietnam edge hit) is not measured here.
* **CSS is one 204 KB file** (24 KB Brotli) for all pages; splitting the admin
  utilities out was not worth the duplicated theme layer.
* **The entry script is not in the Early Hints** (the stylesheet, the two
  fonts and the home hero are).

## Measuring it again

```bash
# a demo database and the build
cd frontend && bun install && bun run build
STATIC_FILES_DIR=$PWD/dist DATABASE_URL=sqlite://demo.db?mode=rwc ... cargo run -- serve

# Lighthouse (from a directory that is not the repository)
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  npx lighthouse http://127.0.0.1:8080/ --preset=perf --form-factor=mobile \
  --throttling-method=simulate --chrome-flags="--headless=new" \
  --only-categories=performance,seo --output=json --output-path=home.json
```

The live site refuses non-browser user agents on `/api` (anti-scraping);
Lighthouse sends a Chrome one.
