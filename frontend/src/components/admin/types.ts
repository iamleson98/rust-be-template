/**
 * Shared types + display constants for the AdminBrandManagement module.
 *
 * Extracted verbatim from the original `admin-brand-management.tsx` (lines
 * 81-184) so the form/dialog components can import a single source of truth.
 */

import { Wifi, Snowflake, Droplet, Plug, type LucideIcon } from 'lucide-react'

export type Brand = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  description: string | null
  contactPhone: string | null
  contactEmail: string | null
  rating: number
  status: string
  accentColor: string
  totalTrips: number
  routeCount: number
  layoutCount: number
}

export type Place = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
  population?: number
}

export type RouteItem = {
  id: string
  brandId: string
  code: string
  name: string
  slug: string
  startLocationId: string
  endLocationId: string
  distanceKm: number
  durationMin: number
  status: string
  startLocation: { id: string; name: string; province: string | null } | null
  endLocation: { id: string; name: string; province: string | null } | null
  scheduleCount: number
  pickupPointCount: number
}

export type BusLayout = {
  id: string
  brandId: string
  name: string
  capacity: number
  deckCount: number
  vehicleType: string
  seatCount: number
  scheduleCount: number
}

export type Schedule = {
  id: string
  routeId: string
  departureTime: string
  effectiveFrom: string
  effectiveTo: string
  daysOfWeek: string
  busLayoutId: string
  basePriceAdult: number
  basePriceChild: number
  amenities: string
  busLayout: { id: string; name: string; capacity: number; vehicleType: string } | null
}

export type PickupPoint = {
  id: string
  routeId: string
  placeId: string
  name: string
  stopOrder: number
  etaOffsetMin: number
  lat: number
  lon: number
  pickupType: string
  address: string | null
  place: { id: string; name: string; province: string | null; lat: number; lon: number } | null
}

export const DAY_LABELS = ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
export const DAY_FULL = ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN']

export const AMENITY_OPTIONS: { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'wifi', label: 'Wifi', icon: Wifi },
  { key: 'ac', label: 'Điều hoà', icon: Snowflake },
  { key: 'water', label: 'Nước uống', icon: Droplet },
  { key: 'charging', label: 'Cắm sạc', icon: Plug },
]

export const PICKUP_TYPE_LABELS: Record<string, string> = {
  station: 'Bến xe',
  curb: 'Đón ven đường',
  on_request: 'Theo yêu cầu',
}

/** Discriminated union used by the delete-confirmation AlertDialog. */
export type DeleteTarget =
  | { kind: 'brand'; id: string; name: string }
  | { kind: 'route'; id: string; name: string }
  | { kind: 'schedule'; id: string; name: string }
  | { kind: 'pickup'; id: string; name: string }
  | null
