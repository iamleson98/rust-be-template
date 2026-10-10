import type { BookingOut } from '@/api'

/** A ticket as the API returns it (`GET /api/bookings`, `GET /api/bookings/{id}`). */
export type BookingItem = BookingOut

/** The customer's review of a ticket's trip. */
export type ReviewSummary = NonNullable<BookingOut['review']>

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
  cod: 'bookingHistory.payOnBoard',
  momo: 'payment.momo',
  vnpay: 'payment.vnpay',
  vietqr: 'payment.vietqr',
  zalopay: 'payment.zalopay',
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

/** Where a ticket stands, as the customer reads it. */
export type TicketStage = 'awaiting' | 'paying' | 'confirmed' | 'completed' | 'cancelled'

/** A placed pay-on-board ticket waits for the operator's call; an online one for its payment. */
export function ticketStage(b: Pick<BookingItem, 'status' | 'paymentMethod'>): TicketStage {
  if (b.status === 'pending') return b.paymentMethod === 'cod' ? 'awaiting' : 'paying'
  if (b.status === 'confirmed' || b.status === 'completed' || b.status === 'cancelled') {
    return b.status
  }
  return 'cancelled'
}

export const STAGE_CONFIG: Record<
  TicketStage,
  { labelKey: string; cls: string; icon: 'check' | 'clock' | 'xcircle' | 'phone' }
> = {
  awaiting: {
    labelKey: 'bookingHistory.statusAwaiting',
    cls: 'bg-amber-100 text-amber-700',
    icon: 'phone',
  },
  paying: {
    labelKey: 'bookingHistory.statusPaying',
    cls: 'bg-amber-100 text-amber-700',
    icon: 'clock',
  },
  confirmed: {
    labelKey: 'bookingHistory.statusConfirmed',
    cls: 'bg-blue-100 text-blue-700',
    icon: 'check',
  },
  completed: {
    labelKey: 'bookingHistory.statusCompleted',
    cls: 'bg-emerald-100 text-emerald-700',
    icon: 'check',
  },
  cancelled: {
    labelKey: 'bookingHistory.statusCancelled',
    cls: 'bg-rose-100 text-rose-700',
    icon: 'xcircle',
  },
}

/** When the trip leaves (ms since epoch); 0 when unknown. */
export function effectiveDeparture(b: BookingItem): number {
  const at = b.trip?.departureAt ?? b.trip?.departureDate
  const ms = at ? new Date(at).getTime() : NaN
  return Number.isNaN(ms) ? 0 : ms
}

/** The trip has left (known departure in the past). */
export function hasDeparted(b: BookingItem): boolean {
  const departs = effectiveDeparture(b)
  return departs > 0 && departs <= Date.now()
}

/** The trip is over and the customer may review it. */
export function isBookingReviewable(b: BookingItem): boolean {
  if (!b.trip) return false
  return b.status === 'completed' || (b.status === 'confirmed' && hasDeparted(b))
}

/** "Sắp đi": open and not yet departed. */
export function isBookingUpcoming(b: BookingItem): boolean {
  if (b.status !== 'pending' && b.status !== 'confirmed') return false
  return effectiveDeparture(b) > Date.now()
}

/** "Đã đi": completed, or confirmed and departed. */
export function isBookingPast(b: BookingItem): boolean {
  return b.status === 'completed' || (b.status === 'confirmed' && hasDeparted(b))
}

export const isBookingCancelled = (b: BookingItem) => b.status === 'cancelled'
