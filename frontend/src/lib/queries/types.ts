/**
 * Shared API response types for TanStack Query hooks.
 *
 * These mirror the Rust backend's JSON envelopes (see backend-rust/src/routes).
 * Centralizing them here means every component uses the same shape — no drift
 * between the search page, the trip dialog, the recommendations widget, etc.
 */

export type Brand = {
  id: string
  name: string
  slug: string
  accentColor: string
  rating: number
  routeCount?: number
  totalTrips?: number
  logoUrl: string | null
  description?: string | null
  status?: string
}

export type RouteItem = {
  id: string
  slug: string
  name: string
  code: string
  distanceKm: number
  durationMin: number
  brand: { name: string; slug: string; accentColor: string; logoUrl: string | null; rating: number }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  scheduleCount: number
}

export type Campaign = {
  id: string
  code: string
  name: string
  type: string
  value: number
  scope: string
  minSubtotal: number
  maxDiscount: number
  description: string | null
  bannerColor: string
  brandId: string | null
  brand?: { name: string | null } | null
}

export type TripResult = {
  tripId: string
  routeId: string
  routeName: string
  routeSlug: string
  brandId: string
  brandName: string
  brandSlug: string
  brandLogo: string | null
  brandRating: number
  brandAccent: string
  fromName: string
  toName: string
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  departureTime: string
  departureAt: string
  arrivalTime: string
  arrivalAt: string
  durationMin: number
  distanceKm: number
  vehicleType: string
  vehicleTypeLabel: string
  capacity: number
  availableSeats: number
  totalSeats: number
  minPrice: number
  maxPrice: number
  priceAdult: number
  priceChild: number
  amenities: string[]
  scheduleId: string
  busLayoutId: string
  matchType?: 'exact' | 'nearby' | 'partial'
  fromDistanceKm?: number
  toDistanceKm?: number
  proximityScore?: number
}

export type TripDetail = {
  trip: {
    id: string
    scheduleId: string
    departureDate: string
    departureAt: string
    arrivalAt: string
    departureTime: string
    arrivalTime: string
    durationMin: number
    availableSeats: number
    totalSeats: number
    status: string
  }
  route: {
    id: string
    slug: string
    name: string
    code: string
    distanceKm: number
    durationMin: number
  }
  brand: {
    id: string
    slug: string
    name: string
    accentColor: string
    logoUrl: string | null
    rating: number
  }
  from: { id: string; name: string; lat: number; lon: number }
  to: { id: string; name: string; lat: number; lon: number }
  busLayout: {
    id: string
    name: string
    vehicleType: string
    vehicleTypeLabel?: string
    capacity: number
    decks: number
  }
  pricing: {
    minPrice: number
    maxPrice: number
    priceAdult: number
    priceChild: number
    currency: string
  }
  amenities: { key: string; label: string; icon?: string }[]
  pickupPoints: {
    id: string
    name: string
    address: string | null
    stopOrder: number
    time: string | null
    lat: number | null
    lon: number | null
  }[]
  seatMap: {
    decks: {
      deck: number
      rows: {
        row: number
        seats: {
          id: string
          code: string
          row: number
          col: number
          deck: number
          seatClass: string
          priceMultiplier: number
          status: string
          finalPrice: number
        }[]
      }[]
    }[]
  }
  campaigns: Campaign[]
}

export type Place = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
}

export type ReviewItem = {
  id: string
  authorName: string
  authorAvatar?: string | null
  rating: number
  title?: string | null
  comment: string
  images?: string[]
  brandReply?: string | null
  repliedAt?: string | null
  status?: string
  createdAt: string
  routeId?: string
  brandId?: string
  helpfulCount?: number
}

export type ReviewSummary = {
  total: number
  average: number
  distribution?: Record<string, number>
}

export type BookingItem = {
  id: string
  code: string
  status: string
  tripId?: string
  routeName?: string
  brandName?: string
  brandAccent?: string
  fromName?: string
  toName?: string
  departureAt?: string
  departureTime?: string
  seatCodes?: string[]
  passengerName?: string
  passengerPhone?: string
  totalAmount: number
  paidAmount?: number
  paymentStatus?: string
  createdAt: string
  cancelledAt?: string | null
  canCancel?: boolean
  canReview?: boolean
}

export type NotificationItem = {
  id: string
  type: string
  title: string
  body: string
  link: string | null
  iconKey: string | null
  readAt: string | null
  createdAt: string
}

export type RecommendationItem = {
  tripId: string
  routeId: string
  routeName: string
  brandId: string
  brandName: string
  brandAccent: string
  brandLogo: string | null
  fromName: string
  toName: string
  durationMin: number
  distanceKm: number
  departureTime: string
  minPrice: number
  vehicleTypeLabel: string
  reason: 'recent' | 'wishlist' | 'booking' | 'trending'
  reasonLabel: string
}

export type WishlistItem = {
  id: string
  tripId?: string
  routeId?: string
  fromName: string
  toName: string
  brandName?: string
  brandAccent?: string
  minPrice?: number
  departureTime?: string
  createdAt: string
}

export type PriceAlert = {
  id: string
  phone: string
  email?: string | null
  fromName: string | null
  toName: string | null
  routeId?: string | null
  /** Target price in VND. The backend stores it as the canonical field;
   * `maxPrice` is kept as a legacy alias for older UI code. */
  targetPrice: number
  maxPrice?: number
  frequency: 'immediate' | 'daily' | 'weekly' | string
  status: 'active' | 'cancelled' | string
  createdAt: string
  expiresAt?: string | null
  lastTriggeredAt?: string | null
  /** Set by the create endpoint when a duplicate alert was returned. */
  duplicate?: boolean
}

// ── Admin-domain types ──────────────────────────────────────────
export type AdminBrand = Brand & {
  status: string
  routeCount: number
  layoutCount: number
  createdAt?: string
}

export type AdminRoute = RouteItem & {
  status?: string
  brandId: string
  scheduleCount: number
}

export type AdminSchedule = {
  id: string
  routeId: string
  routeName?: string
  brandName?: string
  departureTime: string
  arrivalTime?: string
  daysOfWeek: string
  busLayoutId: string
  busLayoutName?: string
  priceAdult: number
  priceChild: number
  active: boolean
}

export type AdminPickupPoint = {
  id: string
  routeId: string
  routeName?: string
  name: string
  address: string | null
  stopOrder: number
  time: string | null
  place?: { name: string; lat: number; lon: number } | null
}

export type AdminReview = ReviewItem & {
  brandName?: string
  brandId?: string
  routeName?: string
}

export type AdminBusLayout = {
  id: string
  name: string
  vehicleType: string
  capacity: number
  decks: number
  seatCount: number
  scheduleCount: number
  brandId?: string | null
  brandName?: string | null
}

// ── Admin Booking (sold ticket) domain ──────────────────────────
//
// These types back the new "Vé đã bán" admin tab + the chat-panel ticket
// picker. They mirror the JSON shapes returned by the Rust endpoints in
// `backend-rust/src/logic/admin.rs` (`list_bookings`, `get_booking`,
// `booking_stats`, `booking_export`, `create_booking_for_user`,
// `update_booking_status`).
//
// Status values:
//   `pending`   — just created (10-min hold, unpaid)
//   `confirmed` — paid & ready to travel (alias: `paid`)
//   `completed` — trip finished ("done")
//   `cancelled` — voided
//   `refunded`  — cancelled + money returned

export type AdminBookingStatus =
  | 'pending'
  | 'confirmed'
  | 'paid'
  | 'completed'
  | 'cancelled'
  | 'refunded'
  | 'all'

export type AdminBookingRange =
  | 'today'
  | '7d'
  | '30d'
  | '90d'
  | 'this_month'
  | 'last_month'
  | 'custom'

export type AdminBookingSort =
  | 'created_desc'
  | 'created_asc'
  | 'total_desc'
  | 'total_asc'
  | 'departure_asc'
  | 'departure_desc'

export type AdminBookingFilter = {
  brandId?: string
  routeId?: string
  status?: AdminBookingStatus | string
  dateFrom?: string
  dateTo?: string
  range?: AdminBookingRange | string
  search?: string
  limit?: number
  offset?: number
  sort?: AdminBookingSort | string
}

export type AdminBookingTrip = {
  tripId?: string
  scheduleId?: string
  routeId?: string
  routeName?: string | null
  fromName?: string | null
  toName?: string | null
  departureDate?: string | null
  departureAt?: string | null
  status?: string | null
  brandId?: string | null
  brandName?: string | null
  brandSlug?: string | null
  brandAccent?: string | null
  brandLogo?: string | null
}

export type AdminBookingItem = {
  id: string
  code: string
  status: string
  subtotal?: number | null
  discount?: number | null
  fees?: number | null
  total?: number | null
  currency?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  paymentMethod?: string | null
  pickupName?: string | null
  dropoffName?: string | null
  createdAt: string
  updatedAt?: string
  expiresAt?: string | null
  userId?: string | null
  boardingPointId?: string | null
  droppingPointId?: string | null
  seatsCount: number
  passengers?: string | null
  brandId?: string | null
  trip?: AdminBookingTrip | null
}

export type AdminBookingStats = {
  total: number
  revenue: number
  confirmed: number
  cancelled: number
  completed: number
  pending: number
  refunded: number
}

export type AdminBookingDetail = {
  id: string
  code: string
  status: string
  subtotal?: number | null
  discount?: number | null
  fees?: number | null
  total?: number | null
  currency?: string | null
  contactName?: string | null
  contactPhone?: string | null
  contactEmail?: string | null
  paymentMethod?: string | null
  pickupName?: string | null
  pickupAddress?: string | null
  dropoffName?: string | null
  dropoffAddress?: string | null
  createdAt: string
  updatedAt?: string
  expiresAt?: string | null
  userId?: string | null
  owner?: {
    id: string
    name: string
    phone?: string | null
    email?: string | null
    avatarUrl?: string | null
  } | null
  seats: {
    seatCode: string
    seatClass?: string | null
    passengerName?: string | null
    passengerType?: string | null
    passengerAge?: number | null
    price?: number | null
  }[]
  trip?: {
    id: string
    departureAt?: string | null
    departureDate?: string | null
    status?: string | null
    route?: {
      id: string
      name?: string | null
      from: string
      to: string
      distanceKm?: number | null
      durationMin?: number | null
      brand?: {
        id: string
        name: string
        accentColor?: string | null
        logoUrl?: string | null
        rating?: number | null
      } | null
    } | null
    busLayout?: {
      id: string
      name?: string | null
      vehicleType?: string | null
      capacity?: number | null
    } | null
  } | null
}

export type AdminBookingListResponse = {
  items: AdminBookingItem[]
  total: number
  stats: AdminBookingStats
  filter: AdminBookingFilter
}

export type AdminBookingStatsResponse = {
  totals: AdminBookingStats
  byDay: {
    date: string
    count: number
    revenue: number
    confirmed: number
    cancelled: number
    completed: number
    pending: number
  }[]
  byBrand: {
    brandId: string
    brandName: string
    brandSlug?: string
    brandAccent?: string | null
    count: number
    revenue: number
    confirmed: number
    cancelled: number
    completed: number
    pending: number
  }[]
  filter: AdminBookingFilter
}

export type AdminBookingExportResponse = {
  csv: string
  count: number
  columns: string[]
  filename: string
}

// ── Generic envelope ────────────────────────────────────────────
export type ListEnvelope<T> = { items: T[]; total?: number; unread?: number; stats?: unknown }
