/**
 * 05-public.js — public read-heavy load test.
 *
 * Hammers the unauthenticated public endpoints that power the
 * homepage, search, brand pages, + reviews. These are the
 * highest-RPS endpoints in production — they should be fast + cacheable.
 *
 * ## Scenario mix
 *
 *   30% — homepage browse (stats → brands → recommendations → campaigns)
 *   30% — search trips (the primary conversion path)
 *   20% — place autocomplete (OSM-backed, potentially slow)
 *   10% — list reviews
 *   10% — directions proxy (Valhalla — external dependency)
 *
 * ## No auth required
 *
 * All endpoints here are public. The cookie jar is empty — no login.
 * This makes the test cheaper (no register/login overhead) + closer
 * to the real "anonymous browser" traffic mix.
 *
 * Run:
 *   k6 run tests/k6/scenarios/05-public.js
 */

import { sleep } from 'k6';
import {
  getStats,
  listBrands,
  getRecommendations,
  listCampaigns,
  searchTrips,
  searchPlaces,
  reverseGeocode,
  listReviews,
  listReviewTags,
  directions,
} from '../helpers/public.js';

export const options = {
  stages: [
    { duration: '30s', target: 50 },    // ramp up — public endpoints can handle more RPS
    { duration: '2m', target: 50 },     // hold
    { duration: '30s', target: 100 },    // ramp up to peak
    { duration: '1m', target: 100 },     // hold at peak
    { duration: '30s', target: 0 },      // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<300', 'p(99)<1000'],  // stricter — public endpoints should be fast
    http_req_failed: ['rate<0.01'],
  },
};

export default function () {
  const roll = Math.random();

  if (roll < 0.3) {
    // 30% — homepage browse.
    getStats();
    sleep(0.2);
    listBrands(20);
    sleep(0.2);
    getRecommendations();
    sleep(0.2);
    listCampaigns();
  } else if (roll < 0.6) {
    // 30% — search trips (varied routes + dates).
    const routes = [
      { from: 'Hà Nội', to: 'Đà Nẵng' },
      { from: 'Hà Nội', to: 'TP. Hồ Chí Minh' },
      { from: 'Đà Nẵng', to: 'Hà Nội' },
      { from: 'TP. Hồ Chí Minh', to: 'Đà Nẵng' },
      { from: 'Hải Phòng', to: 'Nha Trang' },
    ];
    const route = routes[Math.floor(Math.random() * routes.length)];
    const date = `2026-${String(Math.floor(Math.random() * 12) + 1).padStart(2, '0')}-${String(Math.floor(Math.random() * 28) + 1).padStart(2, '0')}`;
    searchTrips({ ...route, date, limit: 20 });
    sleep(0.5);
  } else if (roll < 0.8) {
    // 20% — place autocomplete.
    const queries = ['Hà Nội', 'Hồ Chí Minh', 'Đà Nẵng', 'Hải Phòng', 'Nha Trang', 'Huế', 'Cần Thơ'];
    const q = queries[Math.floor(Math.random() * queries.length)];
    searchPlaces(q, 10);
    sleep(0.3);
  } else if (roll < 0.9) {
    // 10% — list reviews.
    listReviews({ limit: 20 });
    sleep(0.3);
    listReviewTags();
  } else {
    // 10% — reverse geocode + directions.
    const lat = 21.0285 + (Math.random() - 0.5) * 0.1;  // around Hà Nội
    const lon = 105.8542 + (Math.random() - 0.5) * 0.1;
    reverseGeocode(lat, lon, 5);
    sleep(0.3);
    // Directions: Hà Nội → Đà Nẵng (a common route).
    directions('21.0285,105.8542;16.0544,108.2022', 'auto', 'vi');
  }

  sleep(0.5 + Math.random() * 0.5);  // 0.5–1s think time
}
