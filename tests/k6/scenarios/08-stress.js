/**
 * 08-stress.js — stress test (find the breaking point).
 *
 * Ramps VUs aggressively until the backend breaks. The goal is to
 * find the maximum sustainable RPS + identify which endpoints degrade
 * first under extreme load.
 *
 * ## What this measures
 *
 *   - At what VU count does p(95) latency exceed 2s?
 *   - At what VU count does the error rate exceed 5%?
 *   - Does the rate limiter (600 RPM / 100 burst) kick in?
 *   - Does the DB connection pool exhaust?
 *   - Does ZeroClaw (if enabled) time out under load?
 *
 * ## How to interpret results
 *
 * The k6 output will show:
 *   - `http_req_duration` — watch for the p(95) + p(99) to spike.
 *   - `http_req_failed` — watch for the rate to climb (429s = rate
 *     limiter, 500s = backend errors).
 *   - `iterations` — the throughput; flattens when the backend saturates.
 *
 * The "breaking point" is where p(95) > 2s OR error rate > 5%.
 *
 * ## Run
 *
 *   k6 run tests/k6/scenarios/08-stress.js
 *
 * With a longer ramp:
 *   k6 run -e STRESS_DURATION=10m tests/k6/scenarios/08-stress.js
 *
 * ## ⚠️ Warning
 *
 * This test WILL cause 429s + 500s — that's the point. Don't run it
 * against a production database without a snapshot/rollback plan.
 */

import { sleep } from 'k6';
import { register, me, login } from '../helpers/auth.js';
import {
  getStats,
  listBrands,
  searchTrips,
  searchPlaces,
  listReviews,
} from '../helpers/public.js';
import {
  listChannels,
  createChannel,
  listMessages,
  sendMessage,
} from '../helpers/chat.js';
import { resetJar } from '../config.js';

// Total stress duration (default 5 minutes). Override via env.
const DURATION = __ENV.STRESS_DURATION || '5m';

export const options = {
  stages: [
    { duration: '30s', target: 50 },     // ramp to 50 quickly
    { duration: '1m', target: 50 },       // hold at 50
    { duration: '30s', target: 100 },     // ramp to 100
    { duration: '1m', target: 100 },      // hold at 100
    { duration: '30s', target: 200 },      // ramp to 200 — expect rate limiter to kick in
    { duration: '1m', target: 200 },       // hold at 200
    { duration: '30s', target: 400 },       // ramp to 400 — expect errors
    { duration: '1m', target: 400 },        // hold at 400
    { duration: '30s', target: 0 },          // ramp down
  ],
  thresholds: {
    // Loose thresholds for the stress test — we EXPECT some failures.
    // The goal is to find the breaking point, not to pass.
    http_req_duration: ['p(99)<10000'],   // 99% under 10s (very loose)
    http_req_failed: ['rate<0.30'],        // allow up to 30% failures (429s + 500s)
  },
  // Don't abort early — we want to see the full ramp even if errors climb.
  noConnectionReuse: false,
  insecureSkipTLSVerify: true,
};

const vuRegistered = new Map();

export default function () {
  // Register on first iteration (mix of new + returning users).
  if (!vuRegistered.has(__VU)) {
    resetJar();
    const reg = register();
    if (reg.status === 200) {
      vuRegistered.set(__VU, true);
    }
    // Even if register failed, continue — the anonymous endpoints still work.
  }

  const roll = Math.random();

  if (roll < 0.4) {
    // 40% — public read (cheap, high RPS).
    getStats();
    sleep(0.1);
    listBrands(20);
    sleep(0.1);
    listReviews({ limit: 20 });
  } else if (roll < 0.6) {
    // 20% — search.
    searchTrips({ from: 'Hà Nội', to: 'Đà Nẵng', date: '2026-12-15', limit: 20 });
    sleep(0.2);
  } else if (roll < 0.75) {
    // 15% — place search (potentially slow — Valhalla/OSM).
    searchPlaces('Hà Nội', 10);
    sleep(0.2);
  } else if (roll < 0.9) {
    // 15% — chat (auth required, heavier).
    if (vuRegistered.has(__VU)) {
      listChannels();
      sleep(0.1);
      const ch = createChannel();
      if (ch.status === 200) {
        let channelId;
        try {
          channelId = ch.json('channel.id');
        } catch {
          return;
        }
        if (channelId) {
          listMessages(channelId, 30, 0);
          sleep(0.1);
          sendMessage(channelId);
        }
      }
    }
  } else {
    // 10% — auth check (cheap, verifies the access token).
    if (vuRegistered.has(__VU)) {
      me();
    }
  }

  // Minimal think time — we're stress testing, not simulating users.
  sleep(0.1);
}
