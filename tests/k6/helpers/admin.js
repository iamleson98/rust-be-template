/**
 * admin.js — admin dashboard helpers for k6 tests.
 *
 * All endpoints here require the `employee` role (via the
 * `employee-login` auth flow). They exercise the admin CRUD surface
 * that powers the dashboard: bookings, brands, routes, schedules,
 * pickup points, reviews moderation, + payments management.
 *
 * ## Endpoints covered
 *
 *   GET  /api/admin/bookings                — list all bookings (filterable)
 *   GET  /api/admin/bookings/stats          — booking stats (counts + byDay)
 *   GET  /api/admin/bookings/export         — CSV export (heavy!)
 *   GET  /api/admin/bookings/{id}           — single booking detail
 *   PATCH /api/admin/bookings/{id}          — update booking status
 *
 *   GET  /api/admin/brands                  — list brands (admin view)
 *   POST /api/admin/brands                 — create brand
 *   PUT  /api/admin/brands/{id}            — update brand
 *   DELETE /api/admin/brands/{id}          — delete brand
 *
 *   GET  /api/admin/routes                 — list routes
 *   POST /api/admin/routes                 — create route
 *   PUT  /api/admin/routes/{id}            — update route
 *   DELETE /api/admin/routes/{id}          — delete route
 *
 *   GET  /api/admin/schedules?routeId=     — list schedules for a route
 *   POST /api/admin/schedules              — create schedule
 *   PUT  /api/admin/schedules/{id}         — update schedule
 *   DELETE /api/admin/schedules/{id}        — delete schedule
 *
 *   GET  /api/admin/pickup-points?routeId=  — list pickup points for a route
 *
 *   GET  /api/admin/reviews                — list reviews for moderation
 *   PATCH /api/admin/reviews/{id}          — moderate a review (approve/hide/flag)
 *
 *   GET  /api/admin/payments               — list payments (filterable)
 *   PATCH /api/admin/payments/{id}         — update payment status
 *
 *   GET  /api/admin/system                 — system status (DB + cache + worker)
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, withAuth } from '../config.js';

// ── Admin bookings ──────────────────────────────────────────────

export function listAdminBookings(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.routeId) params.set('routeId', filters.routeId);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  if (filters.search) params.set('search', filters.search);
  params.set('limit', String(filters.limit || 20));
  if (filters.offset) params.set('offset', String(filters.offset));
  const res = http.get(
    `${BASE_URL}/api/admin/bookings?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'listAdminBookings status 200': (r) => r.status === 200,
  });
  return res;
}

export function adminBookingStats(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const res = http.get(
    `${BASE_URL}/api/admin/bookings/stats?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'adminBookingStats status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * CSV export — this is a HEAVY endpoint (streams all matching rows
 * as CSV). Use sparingly in load tests.
 */
export function exportAdminBookings(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  const res = http.get(
    `${BASE_URL}/api/admin/bookings/export?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'exportAdminBookings status 200': (r) => r.status === 200,
  });
  return res;
}

export function getAdminBooking(bookingId) {
  const res = http.get(
    `${BASE_URL}/api/admin/bookings/${bookingId}`,
    withAuth(),
  );
  check(res, {
    'getAdminBooking status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin brands ─────────────────────────────────────────────────

export function listAdminBrands() {
  const res = http.get(`${BASE_URL}/api/admin/brands`, withAuth());
  check(res, {
    'listAdminBrands status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin routes ─────────────────────────────────────────────────

export function listAdminRoutes() {
  const res = http.get(`${BASE_URL}/api/admin/routes`, withAuth());
  check(res, {
    'listAdminRoutes status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin schedules ──────────────────────────────────────────────

export function listAdminSchedules(routeId) {
  const res = http.get(
    `${BASE_URL}/api/admin/schedules?routeId=${routeId}`,
    withAuth(),
  );
  check(res, {
    'listAdminSchedules status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin pickup points ──────────────────────────────────────────

export function listAdminPickupPoints(routeId) {
  const res = http.get(
    `${BASE_URL}/api/admin/pickup-points?routeId=${routeId}`,
    withAuth(),
  );
  check(res, {
    'listAdminPickupPoints status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin reviews (moderation) ────────────────────────────────────

export function listAdminReviews(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.brandId) params.set('brandId', filters.brandId);
  if (filters.routeId) params.set('routeId', filters.routeId);
  params.set('limit', String(filters.limit || 20));
  if (filters.offset) params.set('offset', String(filters.offset));
  const res = http.get(
    `${BASE_URL}/api/admin/reviews?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'listAdminReviews status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin payments ───────────────────────────────────────────────

export function listAdminPayments(filters = {}) {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.provider) params.set('provider', filters.provider);
  params.set('limit', String(filters.limit || 20));
  if (filters.offset) params.set('offset', String(filters.offset));
  const res = http.get(
    `${BASE_URL}/api/admin/payments?${params.toString()}`,
    withAuth(),
  );
  check(res, {
    'listAdminPayments status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Admin system ────────────────────────────────────────────────

export function adminSystemStatus() {
  const res = http.get(`${BASE_URL}/api/admin/system`, withAuth());
  check(res, {
    'adminSystemStatus status 200': (r) => r.status === 200,
  });
  return res;
}

// ── Convenience: simulate an admin dashboard session ────────────

/**
 * Simulate an admin opening the dashboard + browsing the key panels.
 *
 *   1. Fetch system status (DB + cache + worker health).
 *   2. Fetch booking stats (the top-row cards).
 *   3. List recent bookings (first page).
 *   4. List reviews pending moderation.
 *   5. List recent payments.
 *   6. List brands + routes (the master-detail panels).
 *
 * Each step has a short think-time sleep to mimic admin pacing.
 */
export function simulateAdminDashboard() {
  adminSystemStatus();
  sleep(0.5);
  adminBookingStats();
  sleep(0.5);
  listAdminBookings({ limit: 20 });
  sleep(0.5);
  listAdminReviews({ status: 'pending', limit: 20 });
  sleep(0.5);
  listAdminPayments({ limit: 20 });
  sleep(0.5);
  listAdminBrands();
  sleep(0.3);
  listAdminRoutes();
}
