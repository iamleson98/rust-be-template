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

/** Shape returned by GET /api/users/me/reviews (legacy "Đánh giá của tôi" list). */
export type ReviewItem = {
  id: string
  rating: number
  title: string
  content: string
  tags: string[]
  authorName: string
  status: string
  createdAt: string
  brand: { name: string; accentColor: string }
  route: { name: string; slug: string; fromName: string; toName: string }
}

export const PAYMENT_LABELS: Record<string, string> = {
  momo: 'Ví MoMo',
  vnpay: 'VNPay QR',
  bank: 'Chuyển khoản',
  cash: 'Tiền mặt',
}

export const REVIEW_TAG_LABELS: Record<string, { label: string; emoji: string }> = {
  on_time: { label: 'Đúng giờ', emoji: '⏱️' },
  clean: { label: 'Sạch sẽ', emoji: '✨' },
  friendly_driver: { label: 'Tài xế thân thiện', emoji: '😊' },
  comfortable: { label: 'Thoải mái', emoji: '🛋️' },
  safe_drive: { label: 'An toàn', emoji: '🛡️' },
  value: { label: 'Giá tốt', emoji: '💰' },
  good_wifi: { label: 'Wifi mạnh', emoji: '📶' },
  easy_booking: { label: 'Đặt dễ', emoji: '🎟️' },
}

export const STATUS_CONFIG: Record<string, { label: string; cls: string; icon: 'check' | 'clock' | 'xcircle' | 'alert' | 'landmark' }> = {
  confirmed: { label: 'Đã xác nhận', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  paid: { label: 'Đã thanh toán', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  completed: { label: 'Đã hoàn thành', cls: 'bg-blue-100 text-blue-700', icon: 'check' },
  pending: { label: 'Chờ thanh toán', cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  held: { label: 'Đang giữ chỗ', cls: 'bg-amber-100 text-amber-700', icon: 'clock' },
  cancelled: { label: 'Đã hủy', cls: 'bg-rose-100 text-rose-700', icon: 'xcircle' },
  refunded: { label: 'Đã hoàn tiền', cls: 'bg-slate-100 text-slate-600', icon: 'landmark' },
  expired: { label: 'Hết hạn', cls: 'bg-slate-100 text-slate-600', icon: 'alert' },
}

/** Whether the booking is "reviewable" — i.e. the trip has finished. */
export function isBookingReviewable(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded') return false
  if (b.status === 'completed') return true
  // confirmed/paid → reviewable only if departure date is in the past.
  const depTime = new Date(b.trip.departureAt).getTime()
  return depTime > 0 && depTime < Date.now()
}

/** Whether the booking belongs to the "Sắp đi" (Upcoming) tab. */
export function isBookingUpcoming(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded' || b.status === 'completed') return false
  const depTime = new Date(b.trip.departureAt).getTime()
  return depTime > Date.now()
}

/** Whether the booking belongs to the "Đã đi" (Past) tab. */
export function isBookingPast(b: BookingItem): boolean {
  if (!b.trip) return false
  if (b.status === 'cancelled' || b.status === 'refunded') return false
  if (b.status === 'completed') return true
  const depTime = new Date(b.trip.departureAt).getTime()
  return depTime > 0 && depTime <= Date.now()
}

/** Whether the booking belongs to the "Đã hủy" (Cancelled) tab. */
export function isBookingCancelled(b: BookingItem): boolean {
  return b.status === 'cancelled' || b.status === 'refunded'
}
