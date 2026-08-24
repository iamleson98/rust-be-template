/**
 * config.js — shared k6 test configuration.
 *
 * All scenarios + helpers import from here so the BASE_URL, headers,
 * + cookie jar are consistent across the suite.
 *
 * ## Critical setup (read this!)
 *
 * 1. **Anti-scraping UA blocklist** — the backend rejects any
 *    User-Agent that doesn't look like a browser (must contain
 *    `Mozilla/5.0` + `AppleWebKit|Gecko|KHTML`). The default k6 UA
 *    (`k6/0.x`) is blocked → 403. We set a real Chrome UA here.
 *
 * 2. **Origin/Referer enforcement** — every POST/PATCH/PUT/DELETE to
 *    `/api/*` MUST include an `Origin` (or `Referer`) header that
 *    matches one of the configured `CORS_ORIGINS`. Without it, the
 *    backend returns 403. We set `Origin` on every request here.
 *
 * 3. **Cookie-based auth** — the backend uses httpOnly cookies
 *    (`access_token` + `refresh_token`), NOT `Authorization` headers.
 *    k6's `http.cookieJar()` persists them across requests in the
 *    same VU. We create one jar per VU + pass it to every request.
 *
 * ## Environment variables (override via `-e KEY=VALUE`)
 *
 *   BASE_URL    — backend URL (default http://localhost:8080)
 *   ORIGIN      — allowed origin for the Origin header (default http://localhost:8080)
 *   USER_EMAIL  — existing customer account email (for login scenarios)
 *   USER_PASSWORD — existing customer account password
 *   ADMIN_EMAIL — existing employee account email
 *   ADMIN_PASSWORD — existing employee account password
 */

import http from 'k6/http';

/** Backend base URL. Override with `-e BASE_URL=https://staging.example.com`. */
export const BASE_URL = __ENV.BASE_URL || 'http://localhost:8080';

/**
 * Allowed origin for the `Origin` header. Must match one of the
 * backend's `CORS_ORIGINS` entries or POSTs will be rejected with 403.
 * Default `http://localhost:8080` is in the default CORS list.
 */
export const ORIGIN = __ENV.ORIGIN || 'http://localhost:8080';

/**
 * Browser-like User-Agent. The backend's anti-scraping middleware
 * rejects UAs that don't contain `Mozilla/5.0` + a layout-engine
 * keyword (`AppleWebKit|Gecko|KHTML`). This is a real Chrome UA.
 */
export const BROWSER_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

/** Headers sent on EVERY request (GET + mutation). */
export const commonHeaders = {
  'User-Agent': BROWSER_UA,
  'Origin': ORIGIN,
  'Content-Type': 'application/json',
  'Accept': 'application/json',
};

/**
 * Per-VU cookie jar. The backend's auth cookies are httpOnly + have
 * no `Domain` attribute (same-origin scoping) — k6's jar persists them
 * across requests in the same VU automatically.
 *
 * Each VU calls `getJar()` once + reuses the result for the whole
 * test. This mirrors a single user's browser session.
 *
 * NOTE: k6's `http.cookieJar()` returns a new empty jar each call.
 * We cache it in a module-level variable so the same VU reuses its
 * jar across iterations.
 */
let _jar = null;
export function getJar() {
  if (!_jar) {
    _jar = http.cookieJar();
  }
  return _jar;
}

/**
 * Reset the cookie jar — used when a VU needs to "log out" + log back
 * in as a different user (e.g. admin vs customer scenarios).
 */
export function resetJar() {
  _jar = http.cookieJar();
  return _jar;
}

/**
 * Build the standard k6 request params with our common headers + jar.
 *
 * Usage:
 *   const res = http.get(`${BASE_URL}/api/bookings`, withAuth());
 *   const res = http.post(url, JSON.stringify(body), withAuth());
 */
export function withAuth(extra = {}) {
  return {
    headers: { ...commonHeaders, ...(extra.headers || {}) },
    jar: getJar(),
    ...extra,
  };
}

/**
 * Build a unique email for registration. Uses the VU id + iteration
 * number so concurrent registrations don't collide.
 *
 * Format: `k6-vu{vu}-it{iter}@loadtest.example`
 */
export function uniqueEmail() {
  const vu = __VU;
  const iter = __ITER;
  return `k6-vu${vu}-it${iter}@loadtest.example`;
}

/**
 * Build a unique phone number. Vietnamese mobile format: `+849` + 8 digits.
 * Uses VU id + iteration to avoid collisions.
 */
export function uniquePhone() {
  const vu = __VU;
  const iter = __ITER;
  // Pad to ensure 8 digits after `+849`.
  const num = String(vu * 100000 + (iter % 100000)).padStart(8, '0').slice(-8);
  return `+849${num}`;
}

/**
 * Generate a random Vietnamese-ish chat message body. Used by the
 * chat load scenario to vary the message content.
 */
export function randomMessage() {
  const messages = [
    'Xin chào, tôi cần hỗ trợ',
    'Cho tôi hỏi về lịch trình xe',
    'Tôi muốn hủy vé',
    'Giá vé bao nhiêu?',
    'Có còn chỗ không ạ?',
    'Tôi muốn đặt vé đi Đà Nẵng',
    'Thời gian đi mất bao lâu?',
    'Có giảm giá cho trẻ em không?',
    'Tôi thanh toán bằng MoMo được không?',
    'Xe có wifi không?',
  ];
  return messages[Math.floor(Math.random() * messages.length)];
}

/**
 * Standard k6 thresholds. Each scenario picks the subset it cares
 * about. These are tuned for a single-instance backend on a laptop
 * — adjust for production hardware.
 */
export const thresholds = {
  // 95% of requests should complete in < 500ms.
  // 99% in < 2s. No request should error.
  http_req_duration: ['p(95)<500', 'p(99)<2000'],
  // Error rate should stay under 1% (allow some 429s under stress).
  http_req_failed: ['rate<0.01'],
};

/**
 * Standard k6 stages for a ramp-up → plateau → ramp-down test.
 * Total duration: ~3.5 minutes. Override per-scenario as needed.
 */
export const standardStages = [
  { duration: '30s', target: 20 },   // ramp up to 20 VUs
  { duration: '1m', target: 20 },    // hold at 20 VUs
  { duration: '30s', target: 50 },   // ramp up to 50 VUs
  { duration: '1m', target: 50 },    // hold at 50 VUs
  { duration: '30s', target: 0 },    // ramp down to 0
];
