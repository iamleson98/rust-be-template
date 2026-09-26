/**
 * Shared types for the Trip History / My Bookings surface.
 *
 * These match the shape returned by:
 *   - GET /api/bookings              (authenticated, status-filtered)
 *   - GET /api/bookings/lookup       (guest lookup by code/phone)
 *   - GET /api/users/me/bookings     (legacy phone-based lookup)
 *
 * The booking row carries an optional `review` summary — present iff the
 * authenticated user has already left feedback for this booking. This lets
 * the UI render the "Đánh giá" tab + the per-card feedback form's
 * "already reviewed" state without a second network round-trip.
 */

export type BookingSeat = {
  code: string
  seatClass: string
  price: number
  passengerName: string | null
  passengerType: string
  passengerAge: number
}

export type BookingTrip = {
  id?: string
  departureAt: string
  departureDate: string
  status: string
  routeId?: string
  routeName: string
  fromName: string
  toName: string
  brandId?: string
  brandName: string
  brandAccent: string
  brandLogo: string | null
  busLayoutName: string
  vehicleType: string
}

export type ReviewSummary = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  photos: string[]
  createdAt: string
}

export type BookingItem = {
  id: string
  code: string
  status: string
  subtotal: number
  discount: number
  fees: number
  total: number
  currency: string
  contactName: string
  contactPhone: string
  contactEmail: string | null
  boardingPointId?: string
  droppingPointId?: string
  pickupPointName: string | null
  pickupPointLat?: number | null
  pickupPointLon?: number | null
  pickupPointAddress?: string | null
  droppingPointName: string | null
  paymentMethod: string | null
  createdAt: string
  updatedAt: string
  paidAt: string | null
  cancelledAt: string | null
  expiresAt: string | null
  seats: BookingSeat[]
  trip: BookingTrip | null
  /** Present iff the user has already submitted a review for this booking. */
  review?: ReviewSummary | null
}

/**
 * Shape returned by the review list endpoints (`GET /api/reviews`,
 * `GET /api/reviews/mine`). Mirrors the backend `ReviewOut` DTO —
 * older consumers only read a subset of fields, so everything beyond
 * the core is optional.
 */
export type ReviewItem = {
  id: string
  rating: number
  title: string | null
  content: string | null
  tags: string[]
  photos: string[]
  authorName: string | null
  status: string
  createdAt: string
  bookingId?: string
  brandId?: string
  routeId?: string
  /** The brand's reply (staff-written via moderation). */
  reply?: string | null
  repliedAt?: string | null
  helpfulCount?: number
  brand?: { name: string; accentColor: string }
  route?: { name: string; slug: string; fromName: string; toName: string }
}

// i18n: label values below are translation KEYS (bookingHistory.*) resolved
// at render time via `t(...)` — see the guide's "translate at render time"
// pattern for module-level label maps.

export const PAYMENT_LABELS: Record<string, string> = {
  momo: 'payment.momo',
  vnpay: 'payment.vnpay',
  bank: 'payment.vietqr',
  cash: 'bookingHistory.cash',
}

// `labelKey` is the i18n key — every consumer resolves it at render time
// with `t(...)`. (The legacy Vietnamese `label` field was dropped after
// all consumers switched to `labelKey`.)
export const REVIEW_TAG_LABELS: Record<string, { labelKey: string; emoji: string }> = {
  on_time: { labelKey: 'bookingHistory.tagOnTime', emoji: '⏱️' },
  clean: { labelKey: 'bookingHistory.tagClean', emoji: '✨' },
  friendly_driver: { labelKey: 'bookingHistory.tagFriendlyDriver', emoji: '😊' },
  comfortable: { labelKey: 'bookingHistory.tagComfortable', emoji: '🛋️' },
  safe_drive: { labelKey: 'bookingHistory.tagSafeDrive', emoji: '🛡️' },
  value: { labelKey: 'bookingHistory.tagValue', emoji: '💰' },
  good_wifi: { labelKey: 'bookingHistory.tagGoodWifi', emoji: '📶' },
  easy_booking: { labelKey: 'bookingHistory.tagEasyBooking', emoji: '🎟️' },
}

export const STATUS_CONFIG: Record<string, { labelKey: string; cls: string; icon: 'check' | 'clock' | 'xcircle' | 'alert' | 'landmark' }> = {
  confirmed: { labelKey: 'bookingHistory.statusConfirmed', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  paid: { labelKey: 'bookingHistory.statusPaid', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  completed: { labelKey: 'bookingHistory.statusCompleted', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  pending: { labelKey: 'bookingHistory.statusPending', cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  held: { labelKey: 'bookingHistory.statusHeld', cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  cancelled: { labelKey: 'bookingHistory.statusCancelled', cls: 'bg-rose-100 text-rose-700', icon: 'xcircle' },
  refunded: { labelKey: 'bookingHistory.statusRefunded', cls: 'bg-slate-100 text-slate-600', icon: 'landmark' },
  expired: { labelKey: 'bookingHistory.statusExpired', cls: 'bg-slate-100 text-slate-600', icon: 'alert' },
}

/**
 * Effective departure time for bucketing/reviewability. The API's
 * `departureAt` is the ACTUAL departure (set when the driver checks
 * in — usually absent for past trips); `departureDate` (YYYY-MM-DD)
 * is always present. Fall back so "already departed" detection works.
 */
export function effectiveDeparture(b: BookingItem): number {
  if (!b.trip) return 0
  const t = new Date(b.trip.departureAt || b.trip.departureDate || '').getTime()
  return Number.isNaN(t) ? 0 : t
}

/** Whether the booking is "reviewable" — i.e. the trip has finished. */
export function isBookingReviewable(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded') return false
  if (b.status === 'completed') return true
  // confirmed/paid → reviewable only if departure date is in the past.
  const depTime = effectiveDeparture(b)
  return depTime > 0 && depTime < Date.now()
}

/** Whether the booking belongs to the "Sắp đi" (Upcoming) tab. */
export function isBookingUpcoming(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded' || b.status === 'completed') return false
  const depTime = effectiveDeparture(b)
  return depTime > Date.now()
}

/** Whether the booking belongs to the "Đã đi" (Past) tab. */
export function isBookingPast(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded') return false
  if (b.status === 'completed') return true
  const depTime = effectiveDeparture(b)
  return depTime > 0 && depTime <= Date.now()
}

/** Whether the booking belongs to the "Đã hủy" (Cancelled) tab. */
export function isBookingCancelled(b: BookingItem): boolean {
  return b.status === 'cancelled' || b.status === 'refunded'
}
