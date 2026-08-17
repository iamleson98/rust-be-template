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

import type { SeatInv } from '@/components/trips/seat-map'

export type TripDetailDialogData = {
  trip: {
    id: string
    departureDate: string
    departureAt: string
    departureTime: string
    arrivalAt: string
    arrivalTime: string
    status: string
    driverName: string | null
    totalSeats: number
    availableSeats: number
  }
  route: {
    id: string
    name: string
    slug: string
    code: string
    distanceKm: number
    durationMin: number
    geometry: [number, number][]
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
    id: string
    name: string
    capacity: number
    deckCount: number
    vehicleType: string
    vehicleTypeLabel: string
  }
  pricing: { basePriceAdult: number; basePriceChild: number }
  amenities: { key: string; label: string }[]
  pickupPoints: {
    id: string
    name: string
    stopOrder: number
    etaOffsetMin: number
    lat: number
    lon: number
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
  discountPrograms: {
    id: string
    passengerType: string
    discountType: string
    value: number
    minAge: number
    maxAge: number
  }[]
}
