// Extracted from the original 'live-tracking.tsx'.

// Minimal TripDetail type for live tracking (kept local to avoid circular imports)
export type TripDetail = {
  trip: {
    id: string
    departureAt: string
    arrivalAt: string
    departureTime: string
    arrivalTime: string
    driverName: string | null
  }
  route: {
    id: string
    name: string
    geometry: [number, number][]
  }
  brand: {
    id: string
    name: string
    accentColor: string
    contactPhone: string | null
  }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  busLayout: {
    name: string
    capacity: number
    vehicleType: string
    vehicleTypeLabel: string
  }
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
}

export type TrackingStatus =
  | 'not_departed'
  | 'running'
  | 'stopped'
  | 'arriving_soon'
  | 'arrived'
