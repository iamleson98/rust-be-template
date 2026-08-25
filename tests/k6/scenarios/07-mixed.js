/**
 * 07-mixed.js — mixed workload (realistic user journey).
 *
 * Simulates a realistic traffic mix of anonymous browsers, logged-in
 * customers, + a few admins — all hitting the backend concurrently.
 * This is the closest scenario to real production traffic.
 *
 * ## Traffic mix (per iteration)
 *
 *   50% — anonymous browser (homepage + search + reviews)
 *   30% — logged-in customer (browse + chat + booking)
 *   15% — customer registering for the first time
 *   5%  — admin (dashboard + moderation)
 *
 * ## Setup
 *
 * Anonymous + register paths need no prerequisites. The logged-in
 * customer + admin paths need existing accounts:
 *   USER_EMAIL / USER_PASSWORD — existing customer
 *   ADMIN_EMAIL / ADMIN_PASSWORD — existing employee
 *
 * If unset, those sub-scenarios are skipped (the iteration falls
 * back to the anonymous browse path).
 *
 * Run:
 *   k6 run \
 *     -e USER_EMAIL=user@example.com -e USER_PASSWORD=Pass123! \
 *     -e ADMIN_EMAIL=admin@example.com -e ADMIN_PASSWORD=Pass123! \
 *     tests/k6/scenarios/07-mixed.js
 */

import { sleep } from 'k6';
import { register, login, employeeLogin, me } from '../helpers/auth.js';
import {
  getStats,
  listBrands,
  getRecommendations,
  listCampaigns,
  searchTrips,
  searchPlaces,
  listReviews,
} from '../helpers/public.js';
import {
  listChannels,
  createChannel,
  listMessages,
  sendMessage,
  markRead,
} from '../helpers/chat.js';
import {
  listBookings,
  holdBooking,
  confirmBooking,
  cancelBooking,
} from '../helpers/booking.js';
import {
  adminSystemStatus,
  adminBookingStats,
  listAdminBookings,
  listAdminReviews,
} from '../helpers/admin.js';
import { uniquePhone, resetJar } from '../config.js';

export const options = {
  scenarios: {
    // Anonymous browsers — high RPS, no auth overhead.
    anonymous: {
      executor: 'ramping-vus',
      exec: 'anonymousBrowse',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 30 },
        { duration: '2m', target: 30 },
        { duration: '30s', target: 50 },
        { duration: '1m', target: 50 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    // Logged-in customers — medium RPS, auth + booking overhead.
    customers: {
      executor: 'ramping-vus',
      exec: 'customerJourney',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 10 },
        { duration: '2m', target: 10 },
        { duration: '30s', target: 20 },
        { duration: '1m', target: 20 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
    // Admins — low RPS (only a few admins at any time).
    admins: {
      executor: 'ramping-vus',
      exec: 'adminJourney',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 2 },
        { duration: '3m', target: 2 },
        { duration: '30s', target: 5 },
        { duration: '1m', target: 5 },
        { duration: '30s', target: 0 },
      ],
      gracefulRampDown: '30s',
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<800', 'p(99)<3000'],
    http_req_failed: ['rate<0.03'],
  },
};

// ── Anonymous browse scenario ────────────────────────────────────

export function anonymousBrowse() {
  resetJar();  // ensure no auth cookies
  const roll = Math.random();

  if (roll < 0.4) {
    // 40% — homepage.
    getStats();
    sleep(0.2);
    listBrands(20);
    sleep(0.2);
    getRecommendations();
  } else if (roll < 0.7) {
    // 30% — search.
    const routes = [
      { from: 'Hà Nội', to: 'Đà Nẵng' },
      { from: 'Hà Nội', to: 'TP. Hồ Chí Minh' },
      { from: 'Đà Nẵng', to: 'Hà Nội' },
    ];
    const route = routes[Math.floor(Math.random() * routes.length)];
    searchTrips({ ...route, date: '2026-12-15', limit: 20 });
    sleep(0.5);
  } else if (roll < 0.9) {
    // 20% — place search.
    searchPlaces('Hà Nội', 10);
    sleep(0.3);
  } else {
    // 10% — reviews.
    listReviews({ limit: 20 });
  }

  sleep(0.5 + Math.random() * 0.5);
}

// ── Customer journey scenario ────────────────────────────────────

const customerLoggedIn = new Map();

export function customerJourney() {
  // Login as existing customer on first iteration.
  if (!customerLoggedIn.has(__VU)) {
    resetJar();
    const loginRes = login();
    if (loginRes.status === 200) {
      customerLoggedIn.set(__VU, true);
    }
    return;
  }

  const roll = Math.random();

  if (roll < 0.4) {
    // 40% — chat session.
    listChannels();
    sleep(0.3);
    const ch = createChannel();
    if (ch.status !== 200) return;
    let channelId;
    try {
      channelId = ch.json('channel.id');
    } catch {
      return;
    }
    if (!channelId) return;
    listMessages(channelId, 30, 0);
    sleep(0.3);
    for (let i = 0; i < 3; i++) {
      sendMessage(channelId);
      sleep(0.5 + Math.random());
    }
    markRead(channelId);
  } else if (roll < 0.7) {
    // 30% — browse + search.
    listBrands(20);
    sleep(0.3);
    searchTrips({ from: 'Hà Nội', to: 'Đà Nẵng', date: '2026-12-15', limit: 20 });
    sleep(0.5);
    listBookings(undefined, 20, 0);
  } else if (roll < 0.9) {
    // 20% — booking lifecycle (placeholder ids — will 404, but exercises the path).
    const hold = holdBooking({
      tripId: '00000000-0000-0000-0000-000000000001',
      seatIds: ['00000000-0000-0000-0000-000000000002'],
      contactName: `K6 Customer ${__VU}`,
      contactPhone: uniquePhone(),
    });
    sleep(0.5);
    let bookingId;
    try {
      bookingId = hold.json('id') || hold.json('booking.id');
    } catch {
      return;
    }
    if (bookingId) {
      confirmBooking(bookingId, 'cod');
      sleep(0.3);
      cancelBooking(bookingId, 'k6 cleanup');
    }
  } else {
    // 10% — refresh session (me).
    me();
  }

  sleep(0.5 + Math.random());
}

// ── Admin journey scenario ───────────────────────────────────────

const adminLoggedIn = new Map();

export function adminJourney() {
  if (!adminLoggedIn.has(__VU)) {
    resetJar();
    const loginRes = employeeLogin();
    if (loginRes.status === 200) {
      adminLoggedIn.set(__VU, true);
    }
    return;
  }

  const roll = Math.random();

  if (roll < 0.5) {
    // 50% — dashboard overview.
    adminSystemStatus();
    sleep(0.3);
    adminBookingStats();
    sleep(0.3);
    listAdminBookings({ limit: 20 });
  } else if (roll < 0.8) {
    // 30% — reviews moderation.
    listAdminReviews({ status: 'pending', limit: 20 });
  } else {
    // 20% — payments.
    listAdminBookings({ limit: 20 });
  }

  sleep(1 + Math.random() * 2);  // admins are slower — 1–3s think time
}
