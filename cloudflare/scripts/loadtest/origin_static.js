import http from 'k6/http';
import { check } from 'k6';

// ─────────────────────────────────────────────────────────────────
// ORIGIN STATIC BLAST — direct to VPS 169.58.249.26 (bypasses
// Cloudflare; SNI/Host preserved so the LE cert validates).
// Measures the raw serving capacity of the user's own server:
// nginx SNI → Caddy (TLS/compression) → axum ServeDir.
// ─────────────────────────────────────────────────────────────────

const ORIGIN = '169.58.249.26';
const BASE = 'https://datxevui.com';
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const targets = [
  { name: 'static /index.html', path: '/' },
  { name: 'static /assets/index.css', path: '/assets/index-CMXXe2MN.css' },
  { name: 'static /assets/index.js', path: '/assets/index-DQhW8lTL.js' },
  { name: 'static /sw.js', path: '/sw.js' },
  { name: 'static /robots.txt', path: '/robots.txt' },
  { name: 'static /sitemap.xml', path: '/sitemap.xml' },
  { name: 'static /health', path: '/health' },
];

export const options = {
  hosts: { 'datxevui.com:443': `${ORIGIN}:443` },
  discardResponseBodies: true,
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
  scenarios: {
    blast: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 }, // gentle warm-up
        { duration: '1m', target: 50 }, // light
        { duration: '30s', target: 150 }, // ramp
        { duration: '1m', target: 150 }, // medium
        { duration: '30s', target: 300 }, // ramp
        { duration: '1m', target: 300 }, // heavy
        { duration: '30s', target: 500 }, // ramp
        { duration: '2m', target: 500 }, // peak blast
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
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Encoding': 'gzip, deflate, br',
};

export default function () {
  const t = targets[__ITER % targets.length];
  const res = http.get(BASE + t.path, { headers, tags: { name: t.name } });
  check(res, {
    'status 200': (r) => r.status === 200,
  });
}
