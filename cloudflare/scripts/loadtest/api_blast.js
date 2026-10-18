import http from 'k6/http';
import { check } from 'k6';

// ─────────────────────────────────────────────────────────────────
// API BLAST — datxevui.com
// Hammers public read-only JSON endpoints (brands, routes, place
// autocomplete, trip search incl. the heavy DB-backed search, trip
// detail, stats, recommendations). NO mutations — booking/payment
// flows are deliberately excluded to protect production data.
// ─────────────────────────────────────────────────────────────────

const BASE = 'https://datxevui.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const targets = [
  { name: 'api /brands', path: '/api/brands?limit=20' },
  { name: 'api /routes', path: '/api/routes?limit=20' },
  { name: 'api /places/search', path: '/api/places/search?q=S%C3%A0i&limit=10' },
  {
    name: 'api /search HN->SGN',
    path: '/api/search?from=H%C3%A0%20N%E1%BB%99i&to=S%C3%A0i%20G%C3%B2n&date=2026-10-20&limit=10',
  },
  {
    name: 'api /search DAD->HAN',
    path: '/api/search?from=%C4%90%C3%A0%20N%E1%BA%B5ng&to=H%C3%A0%20N%E1%BB%99i&date=2026-10-22&limit=10',
  },
  { name: 'api /stats', path: '/api/stats' },
  { name: 'api /recommendations', path: '/api/recommendations' },
  {
    name: 'api /trips/{id}',
    path: '/api/trips/8125a84c-e077-4ca9-9f39-2c190ab6d122',
  },
];

export const options = {
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    blast: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 25 }, // warm-up
        { duration: '1m', target: 50 }, // light
        { duration: '1m', target: 100 }, // medium
        { duration: '1m', target: 150 }, // heavy
        { duration: '30s', target: 200 }, // ramp to peak
        { duration: '2m', target: 200 }, // peak sustained
        { duration: '30s', target: 0 }, // cool-down
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

export default function () {
  const t = targets[__ITER % targets.length];
  const res = http.get(BASE + t.path, { headers, tags: { name: t.name } });
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}
