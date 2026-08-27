/**
 * 01-smoke.js — smoke test.
 *
 * Runs 1 VU for 1 iteration. Hits the health endpoints + a few
 * unauthenticated public endpoints to verify the server is up +
 * responding. No auth required — this is the "is it alive?" check.
 *
 * Run:
 *   k6 run tests/k6/scenarios/01-smoke.js
 *
 * Or with a custom base URL:
 *   k6 run -e BASE_URL=http://localhost:8080 tests/k6/scenarios/01-smoke.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, commonHeaders } from '../config.js';

export const options = {
  vus: 1,
  iterations: 1,
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  // Liveness — always 200, no DB check.
  const health = http.get(`${BASE_URL}/health`, { headers: commonHeaders });
  check(health, {
    'health 200': (r) => r.status === 200,
    'health has status ok': (r) => {
      try {
        return r.json('status') === 'ok';
      } catch {
        return false;
      }
    },
  });

  // Readiness — pings the DB. 503 if DB is down.
  const ready = http.get(`${BASE_URL}/ready`, { headers: commonHeaders });
  check(ready, {
    'ready 200': (r) => r.status === 200,
  });

  // Public stats — no auth, exercises DB.
  const stats = http.get(`${BASE_URL}/api/stats`, { headers: commonHeaders });
  check(stats, {
    'stats 200': (r) => r.status === 200,
  });

  // Public brands list — no auth.
  const brands = http.get(`${BASE_URL}/api/brands?limit=10`, { headers: commonHeaders });
  check(brands, {
    'brands 200': (r) => r.status === 200,
  });

  // NullClaw status — no auth, instant.
  const zc = http.get(`${BASE_URL}/api/nullclaw/status`, { headers: commonHeaders });
  check(zc, {
    'nullclaw status 200': (r) => r.status === 200,
  });

  sleep(0.5);
}
