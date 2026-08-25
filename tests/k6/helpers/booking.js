/**
 * booking.js — booking + payment helpers for k6 tests.
 *
 * Wraps the booking lifecycle endpoints:
 *
 *   GET  /api/bookings                    — list the user's bookings
 *   POST /api/bookings                   — hold seats (creates a pending booking)
 *   POST /api/bookings/{id}/confirm      — confirm a held booking with a payment method
 *   POST /api/bookings/{id}/cancel       — cancel a booking (releases held seats)
 *   GET  /api/bookings/{id}              — fetch a booking by id
 *   GET  /api/bookings/lookup            — guest lookup by phone + booking code
 *
 *   POST /api/payments                   — create a payment for a booking
 *   GET  /api/payments/{id}              — poll payment status
 *   GET  /api/payments/booking/{bid}     — list payments for a booking
 *   POST /api/payments/{id}/cancel       — cancel a pending payment
 *
 * ## Search prerequisites
 *
 * The hold flow needs a valid `tripId` + seat ids. These come from
 * `GET /api/search?from=...&to=...&date=...`. The search endpoints
 * are in `helpers/public.js` — import `searchTrips` from there if
 * your scenario needs to discover trip ids at runtime.
 *
 * For load tests that don't depend on real data, the helpers below
 * accept the trip/seat ids as parameters so you can pre-seed them
 * via environment variables or a setup step.
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, withAuth } from '../config.js';

/**
 * List the current user's bookings.
 *
 * @param {string} [status] — filter by status ('pending' | 'confirmed' | 'cancelled' | 'completed')
 * @param {number} [limit=20]
 * @param {number} [offset=0]
 * @returns {object} the k6 response
 */
export function listBookings(status, limit = 20, offset = 0) {
  let url = `${BASE_URL}/api/bookings?limit=${limit}&offset=${offset}`;
  if (status) url += `&status=${status}`;
  const res = http.get(url, withAuth());
  check(res, {
    'listBookings status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Hold seats — creates a pending booking that reserves the seats
 * for a short window (default 10 minutes) before auto-releasing.
 *
 * @param {object} params — required:
 *   - tripId: UUID of the trip
 *   - seatIds: array of seat UUIDs (1-50)
 *   - contactName: string
 *   - contactPhone: string (Vietnamese mobile format)
 *   optional:
 *   - boardingPointId, droppingPointId: UUIDs
 *   - contactEmail: string
 *   - campaignCode: string
 *   - passengers: array of { name, type, age }
 * @returns {object} the k6 response — `res.json()` has the booking
 *   with `id`, `code`, `status: 'pending'`, `expiresAt`.
 */
export function holdBooking(params) {
  const body = {
    tripId: params.tripId,
    seatIds: params.seatIds,
    passengers: params.passengers || [
      { name: params.contactName, type: 'adult', age: 30 },
    ],
    boardingPointId: params.boardingPointId,
    droppingPointId: params.droppingPointId,
    contactName: params.contactName,
    contactPhone: params.contactPhone,
    contactEmail: params.contactEmail,
    campaignCode: params.campaignCode,
  };
  const res = http.post(
    `${BASE_URL}/api/bookings`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'holdBooking status 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  return res;
}

/**
 * Confirm a held booking with a payment method.
 *
 * @param {string} bookingId — the booking UUID
 * @param {string} [paymentMethod='momo'] — one of 'vnpay' | 'momo' | 'zalopay' | 'vietqr' | 'cod'
 * @returns {object} the k6 response — the booking is now `confirmed`
 */
export function confirmBooking(bookingId, paymentMethod = 'momo') {
  const res = http.post(
    `${BASE_URL}/api/bookings/${bookingId}/confirm`,
    JSON.stringify({ paymentMethod }),
    withAuth(),
  );
  check(res, {
    'confirmBooking status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Cancel a booking — releases held seats.
 *
 * @param {string} bookingId — the booking UUID
 * @param {string} [reason] — optional cancellation reason
 * @returns {object} the k6 response — the booking is now `cancelled`
 */
export function cancelBooking(bookingId, reason) {
  const body = {};
  if (reason) body.reason = reason;
  const res = http.post(
    `${BASE_URL}/api/bookings/${bookingId}/cancel`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'cancelBooking status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Fetch a single booking by id.
 *
 * @param {string} bookingId — the booking UUID
 * @returns {object} the k6 response
 */
export function getBooking(bookingId) {
  const res = http.get(`${BASE_URL}/api/bookings/${bookingId}`, withAuth());
  check(res, {
    'getBooking status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Guest booking lookup by phone + booking code.
 *
 * No auth required — used by the "lookup my booking" form before login.
 *
 * @param {string} phone — the contact phone used at booking time
 * @param {string} code — the booking code (e.g. "VV-ABC123")
 * @returns {object} the k6 response
 */
export function lookupBooking(phone, code) {
  const res = http.get(
    `${BASE_URL}/api/bookings/lookup?phone=${encodeURIComponent(phone)}&code=${encodeURIComponent(code)}`,
    withAuth(),
  );
  check(res, {
    'lookupBooking status 200 or 404': (r) => r.status === 200 || r.status === 404,
  });
  return res;
}

/**
 * Create a payment for a booking.
 *
 * The response includes `gatewayUrl`, `qrPayload`, `qrImageDataUri`
 * depending on the provider — used to redirect the user to the
 * payment gateway or display a QR code.
 *
 * @param {string} bookingId — the booking UUID
 * @param {string} [provider='momo'] — 'vnpay' | 'momo' | 'zalopay' | 'vietqr' | 'cod'
 * @returns {object} the k6 response
 */
export function createPayment(bookingId, provider = 'momo') {
  const res = http.post(
    `${BASE_URL}/api/payments`,
    JSON.stringify({ bookingId, provider }),
    withAuth(),
  );
  check(res, {
    'createPayment status 200 or 201': (r) => r.status === 200 || r.status === 201,
  });
  return res;
}

/**
 * Poll a payment's status.
 *
 * The payment goes through states: `pending` → `succeeded` (or
 * `failed`/`cancelled`). In a real flow the user is redirected to
 * the gateway + the gateway calls back via IPN. For load testing,
 * we just poll the status endpoint.
 *
 * @param {string} paymentId — the payment UUID
 * @returns {object} the k6 response
 */
export function getPayment(paymentId) {
  const res = http.get(`${BASE_URL}/api/payments/${paymentId}`, withAuth());
  check(res, {
    'getPayment status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * List payments for a booking.
 *
 * @param {string} bookingId — the booking UUID
 * @returns {object} the k6 response
 */
export function listBookingPayments(bookingId) {
  const res = http.get(
    `${BASE_URL}/api/payments/booking/${bookingId}`,
    withAuth(),
  );
  check(res, {
    'listBookingPayments status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Cancel a pending payment.
 *
 * @param {string} paymentId — the payment UUID
 * @param {string} [reason] — optional cancellation reason
 * @returns {object} the k6 response
 */
export function cancelPayment(paymentId, reason) {
  const body = {};
  if (reason) body.reason = reason;
  const res = http.post(
    `${BASE_URL}/api/payments/${paymentId}/cancel`,
    JSON.stringify(body),
    withAuth(),
  );
  check(res, {
    'cancelPayment status 200': (r) => r.status === 200,
  });
  return res;
}

/**
 * Convenience: simulate the full booking lifecycle.
 *
 *   1. Hold a booking (seats reserved, status = 'pending').
 *   2. Confirm with COD payment (status = 'confirmed').
 *   3. Create a payment record.
 *   4. Poll the payment status.
 *   5. Cancel the booking (releases seats, status = 'cancelled').
 *
 * Each step has a short think-time sleep to mimic human pacing.
 *
 * NOTE: This requires a valid `tripId` + `seatIds` to be passed in.
 * In a real load test, seed these via a setup step that calls
 * `searchTrips` from `helpers/public.js` + extracts seat ids from
 * the trip detail.
 *
 * @param {object} params — { tripId, seatIds, contactName, contactPhone }
 * @returns {string|null} the booking id (for follow-up calls)
 */
export function simulateBookingLifecycle(params) {
  const hold = holdBooking(params);
  sleep(0.5);
  if (hold.status !== 200 && hold.status !== 201) return null;
  let bookingId;
  try {
    bookingId = hold.json('id') || hold.json('booking.id');
  } catch {
    return null;
  }
  if (!bookingId) return null;

  confirmBooking(bookingId, 'cod');
  sleep(0.5);

  const payment = createPayment(bookingId, 'cod');
  sleep(0.5);
  let paymentId = null;
  try {
    paymentId = payment.json('id') || payment.json('payment.id');
  } catch {
    /* ignore — we'll skip the poll if we can't find the id */
  }
  if (paymentId) {
    getPayment(paymentId);
    sleep(0.3);
    listBookingPayments(bookingId);
    sleep(0.3);
  }

  cancelBooking(bookingId, 'k6 load test — cancelling');
  return bookingId;
}
