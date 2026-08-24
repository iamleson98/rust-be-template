/**
 * 06-admin.js — admin dashboard load test.
 *
 * Simulates admin staff using the dashboard:
 *   - System status (DB + cache + worker health check)
 *   - Booking stats + list (the main dashboard view)
 *   - Reviews moderation queue
 *   - Payments management
 *   - Brands + routes master-detail panels
 *
 * ## Prerequisites
 *
 * Requires an existing EMPLOYEE account. Set `ADMIN_EMAIL` +
 * `ADMIN_PASSWORD` env vars. The VU logs in via
 * `POST /api/auth/employee-login` on the first iteration + reuses
 * the session for all subsequent iterations.
 *
 * Run:
 *   k6 run -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=Pass123! \
 *     tests/k6/scenarios/06-admin.js
 */

import { sleep } from 'k6';
import { employeeLogin, me } from '../helpers/auth.js';
import {
  adminSystemStatus,
  adminBookingStats,
  listAdminBookings,
  listAdminReviews,
  listAdminPayments,
  listAdminBrands,
  listAdminRoutes,
  listAdminSchedules,
  listAdminPickupPoints,
  exportAdminBookings,
} from '../helpers/admin.js';

export const options = {
  stages: [
    { duration: '30s', target: 5 },    // ramp up — fewer VUs since admin endpoints are heavier
    { duration: '1m', target: 5 },     // hold
    { duration: '30s', target: 10 },   // ramp up
    { duration: '1m', target: 10 },    // hold
    { duration: '30s', target: 0 },    // ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<2000'],
    http_req_failed: ['rate<0.02'],
  },
};

const vuLoggedIn = new Map();

export default function () {
  // Login as employee on first iteration.
  if (!vuLoggedIn.has(__VU)) {
    const login = employeeLogin();
    if (login.status === 200) {
      vuLoggedIn.set(__VU, true);
      sleep(0.3);
      me();
    }
    return;
  }

  const roll = Math.random();

  if (roll < 0.3) {
    // 30% — dashboard overview (the main view).
    adminSystemStatus();
    sleep(0.3);
    adminBookingStats();
    sleep(0.3);
    listAdminBookings({ limit: 20 });
  } else if (roll < 0.5) {
    // 20% — reviews moderation queue.
    listAdminReviews({ status: 'pending', limit: 20 });
    sleep(0.5);
    listAdminReviews({ status: 'published', limit: 20 });
  } else if (roll < 0.7) {
    // 20% — payments management.
    listAdminPayments({ limit: 20 });
    sleep(0.3);
    listAdminPayments({ status: 'pending', limit: 20 });
  } else if (roll < 0.85) {
    // 15% — brands + routes master-detail.
    listAdminBrands();
    sleep(0.3);
    listAdminRoutes();
  } else if (roll < 0.95) {
    // 10% — schedules + pickup points (needs a route id; use placeholder).
    const routeId = __ENV.ROUTE_ID || '00000000-0000-0000-0000-000000000001';
    listAdminSchedules(routeId);
    sleep(0.3);
    listAdminPickupPoints(routeId);
  } else {
    // 5% — CSV export (HEAVY — only 5% of iterations to avoid OOM).
    exportAdminBookings();
  }

  sleep(0.5 + Math.random() * 1);  // 0.5–1.5s think time
}
