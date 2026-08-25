/**
 * 04-booking.js — booking lifecycle load test.
 *
 * Simulates the full booking flow:
 *   1. Search trips (from → to → date).
 *   2. Fetch trip detail (to get seat ids — but for load testing
 *      we use placeholder UUIDs since real seat ids depend on seeded data).
 *   3. Hold a booking (seats reserved, status = 'pending').
 *   4. Confirm with COD payment (status = 'confirmed').
 *   5. Create a payment record.
 *   6. Poll the payment status.
 *   7. Cancel the booking (releases seats, status = 'cancelled').
 *
 * ## Prerequisites
 *
 * The hold flow needs a valid `tripId` + `seatIds`. These come from
 * the search results, but for load testing we use placeholder UUIDs
 * (the backend will return 404/400 for invalid ids — that's fine,
 * it still exercises the auth + validation + DB query path).
 *
 * For a realistic test with real data, set these env vars:
 *   TRIP_ID     — a valid trip UUID
 *   SEAT_ID_1   — a valid seat UUID for that trip
 *   SEAT_ID_2   — another seat UUID
 *   CONTACT_NAME — contact name (default "K6 Customer")
 *   CONTACT_PHONE — contact phone (default a generated unique number)
 *
 * Run:
 *   k6 run tests/k6/scenarios/04-booking.js
 *
 * With real trip data:
 *   k6 run -e TRIP_ID=<uuid> -e SEAT_ID_1=<uuid> \
 *     tests/k6/scenarios/04-booking.js
 */

import { sleep } from 'k6';
import { register, me } from '../helpers/auth.js';
import { searchTrips, getTrip } from '../helpers/public.js';
import {
  listBookings,
  holdBooking,
  confirmBooking,
  cancelBooking,
  createPayment,
  getPayment,
  listBookingPayments,
} from '../helpers/booking.js';
import { uniquePhone } from '../config.js';

export const options = {
  stages: [
    { duration: '30s', target: 15 },
    { duration: '1m', target: 15 },
    { duration: '30s', target: 30 },
    { duration: '1m', target: 30 },
    { duration: '30s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000', 'p(99)<3000'],
    http_req_failed: ['rate<0.10'],  // allow 404s for placeholder trip/seat ids
  },
};

const vuRegistered = new Map();

export default function () {
  // Register on first iteration.
  if (!vuRegistered.has(__VU)) {
    const reg = register();
    if (reg.status === 200) {
      vuRegistered.set(__VU, true);
      sleep(0.3);
      me();
    }
    return;
  }

  // ── Browse + search ──────────────────────────────────────────
  searchTrips({
    from: 'Hà Nội',
    to: 'Đà Nẵng',
    date: '2026-12-15',
    limit: 20,
  });
  sleep(0.5);

  // If a real trip id is provided, fetch its detail.
  const tripId = __ENV.TRIP_ID || '00000000-0000-0000-0000-000000000001';
  if (__ENV.TRIP_ID) {
    getTrip(tripId);
    sleep(0.3);
  }

  // ── List existing bookings (refresh the list) ─────────────────
  listBookings(undefined, 20, 0);
  sleep(0.3);

  // ── Hold a booking ────────────────────────────────────────────
  // Use env-provided seat ids if available; otherwise use a
  // placeholder UUID (will 404 — that's fine for load generation).
  const seatIds = [
    __ENV.SEAT_ID_1 || '00000000-0000-0000-0000-000000000002',
    __ENV.SEAT_ID_2 || '00000000-0000-0000-0000-000000000003',
  ];
  const holdParams = {
    tripId,
    seatIds,
    contactName: `K6 Customer ${__VU}-${__ITER}`,
    contactPhone: uniquePhone(),
    contactEmail: undefined,
    campaignCode: undefined,
    boardingPointId: undefined,
    droppingPointId: undefined,
  };
  const hold = holdBooking(holdParams);
  sleep(0.5);

  if (hold.status !== 200 && hold.status !== 201) return;

  let bookingId;
  try {
    bookingId = hold.json('id') || hold.json('booking.id');
  } catch {
    return;
  }
  if (!bookingId) return;

  // ── Confirm with COD ──────────────────────────────────────────
  confirmBooking(bookingId, 'cod');
  sleep(0.5);

  // ── Create + poll a payment ──────────────────────────────────
  const payment = createPayment(bookingId, 'cod');
  sleep(0.3);
  let paymentId = null;
  try {
    paymentId = payment.json('id') || payment.json('payment.id');
  } catch {
    /* skip polling */
  }
  if (paymentId) {
    getPayment(paymentId);
    sleep(0.3);
    listBookingPayments(bookingId);
    sleep(0.3);
  }

  // ── Cancel the booking ────────────────────────────────────────
  cancelBooking(bookingId, 'k6 load test cleanup');
  sleep(0.5);
}
