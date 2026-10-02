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

import type { SeatInv } from '@/features/trips/seat-map'

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
    name: string
    stopOrder: number
    /** Optional per the API — the backend currently emits no ETA
     *  offset for pickup points, so consumers must render nothing
     *  (never a fake "+NaN phút") when it's absent. */
    etaOffsetMin?: number
    /** Nullable per the API — points without coords can't be mapped. */
    lat: number | null
    lon: number | null
    pickupType: string
    address: string | null
  }[]
  seatMap: {
    decks: { deck: number; rows: { row: number; seats: (SeatInv | null)[] }[] }[]
  }
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
