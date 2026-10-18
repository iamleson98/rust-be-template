import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend } from 'k6/metrics';

// ─────────────────────────────────────────────────────────────────
// PRODUCTION-PATH USER JOURNEY — through Cloudflare (real user path)
// Per-endpoint Trend metrics reveal the cached (edge) vs dynamic
// (origin round-trip) latency split that real users experience.
// ─────────────────────────────────────────────────────────────────

const BASE = 'https://datxevui.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const tIndex = new Trend('t_00_index_html');
const tCss = new Trend('t_01_asset_css');
const tJs = new Trend('t_02_asset_js');
const tSw = new Trend('t_03_sw_js');
const tBrands = new Trend('t_04_api_brands');
const tRecs = new Trend('t_05_api_recommendations');
const tPlaces = new Trend('t_06_api_places_search');
const tSearch = new Trend('t_07_api_search');
const tTrip = new Trend('t_08_api_trip_detail');

const searches = [
  '/api/search?from=H%C3%A0%20N%E1%BB%99i&to=S%C3%A0i%20G%C3%B2n&date=2026-10-20&limit=10',
  '/api/search?from=%C4%90%C3%A0%20N%E1%BA%B5ng&to=H%C3%A0%20N%E1%BB%99i&date=2026-10-22&limit=10',
];

const trips = [
  '8125a84c-e077-4ca9-9f39-2c190ab6d122',
  '32c716ed-d4f7-4c3a-b180-c434fff37ae4',
  '6fff8d6b-7e14-4000-a79a-20c1b85a70ca',
  '097435ec-0cc0-40c4-bb1d-6804f116065f',
  'f52c2cb7-74d1-40fe-b958-ca64d0ca76cd',
  '0a3d5f86-4c42-450d-899f-729850b98bee',
];

const autocomplete = [
  '/api/places/search?q=H%C3%A0&limit=5',
  '/api/places/search?q=S%C3%A0i&limit=5',
  '/api/places/search?q=%C4%90%C3%A0&limit=5',
];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    journey: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '1m', target: 200 },
        { duration: '2m', target: 200 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '15s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.02'],
  },
};

const headers = {
  'User-Agent': UA,
  Accept: 'application/json, text/plain, */*',
  'Accept-Encoding': 'gzip, deflate, br',
};

const pageHeaders = {
  'User-Agent': UA,
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

function get(path, trend) {
  const res = http.get(BASE + path, { headers: headers, tags: { name: path } });
  check(res, { ok: (r) => r.status === 200 });
  trend.add(res.timings.duration);
  return res;
}

function getPage(path, trend) {
  const res = http.get(BASE + path, {
    headers: pageHeaders,
    tags: { name: path },
  });
  check(res, { ok: (r) => r.status === 200 });
  trend.add(res.timings.duration);
  return res;
}

export default function () {
  // 1. Visitor opens the site
  getPage('/', tIndex);
  // 2. Browser fetches core static assets
  getPage('/assets/index-CMXXe2MN.css', tCss);
  getPage('/assets/index-DQhW8lTL.js', tJs);
  getPage('/sw.js', tSw);
  sleep(1 + Math.random() * 2);

  // 3. Home hydrates: brand catalog + recommendations
  get('/api/brands?limit=20', tBrands);
  get('/api/recommendations', tRecs);
  sleep(2 + Math.random() * 3);

  // 4. Types a destination (autocomplete)
  get(autocomplete[__ITER % autocomplete.length], tPlaces);
  sleep(0.5 + Math.random());

  // 5. Runs the trip search
  get(searches[__ITER % searches.length], tSearch);
  sleep(2 + Math.random() * 3);

  // 6. Opens one trip's detail page
  get(`/api/trips/${trips[__ITER % trips.length]}`, tTrip);
  sleep(3 + Math.random() * 5);
}
