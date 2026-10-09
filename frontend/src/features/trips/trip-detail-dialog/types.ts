/**
 * Shared types for the TripDetailDialog module.
 *
 * `TripDetailDialogData` is the aggregated payload the dialog renders:
 *   { trip, route, brand, from, to, busLayout, pricing, amenities,
 *     pickupPoints, seatMap, campaigns, discountPrograms }
 *
 * Renamed from `TripDetail` to avoid collision with the generated SDK
 * `TripDetail` type (re-exported from @/lib/queries), which is the
 * flat shape returned by `GET /api/trips/{id}`.
 */

import type { TripSeatDeck } from '@/api'

export type TripDetailDialogData = {
  trip: {
    id: string
    departureDate: string
    /** ISO timestamp — null when the schedule has no departure time. */
    departureAt: string | null
    /** "HH:MM" time-only string — null when the schedule omits it. */
    departureTime: string | null
    /** ISO timestamp — null: the backend no longer computes arrivals
     *  (no route-level duration; see compute_iso_timestamps). */
    arrivalAt: string | null
    arrivalTime: string | null
    status: string
    driverName: string | null
    totalSeats: number
    availableSeats: number
  }
  route: {
    id: string
    name: string
    /** Not emitted by the API (no route geometry column) — kept
     *  optional so the map preview can degrade to an endpoint line. */
    slug?: string | null
    code?: string | null
    geometry?: [number, number][] | null
  }
  brand: {
    id: string
    name: string
    slug: string
    logoUrl: string | null
    rating: number
    accentColor: string
    contactPhone: string | null
    description: string | null
  }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  busLayout: {
    id?: string | null
    name?: string | null
    capacity?: number | null
    deckCount?: number
    vehicleType: string
    vehicleTypeLabel: string
  }
  pricing: { basePriceAdult: number; basePriceChild: number }
  amenities: { key: string; label: string }[]
  pickupPoints: {
    id: string
    /** Nullable per the API — render a fallback, never `undefined`. */
    name: string | null
    stopOrder: number
    /**
     * Position-derived kind the backend emits: "pickup" (first) /
     * "middle" / "drop" (last). NULLABLE — older rows may carry none.
     * (The API field is `kind`; a former local alias `pickupType`
     * never existed on the wire and crashed `.replace()` consumers.)
     */
    kind?: string | null
    /** Optional per the API — the backend currently emits no ETA
     *  offset for pickup points, so consumers must render nothing
     *  (never a fake "+NaN phút") when it's absent. */
    etaOffsetMin?: number
    /** Nullable per the API — points without coords can't be mapped. */
    lat: number | null
    lon: number | null
    address: string | null
  }[]
  /**
   * The schedule's ordered timetable with REAL arrival times from the
   * `schedule_point` table (source of truth the admin maintains).
   * Empty when the schedule has no points — consumers fall back to
   * `pickupPoints` (which carries no times).
   */
  schedulePoints?: {
    id: string
    stopOrder: number
    /** "pickup" (first) / "middle" / "drop" (last). */
    kind: string
    /** "HH:MM" arrival at this stop — null when not configured. */
    arrivalTime: string | null
    name: string
    address: string | null
    lat: number
    lon: number
  }[]
  seatMap: { decks: TripSeatDeck[] }
  campaigns: {
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
  }[]
  /** Not emitted by the current API — optional so consumers guard. */
  discountPrograms?: {
    id: string
    passengerType: string
    discountType: string
    value: number
    minAge: number
    maxAge: number
  }[]
}
