// Extracted from the original 'live-tracking.tsx'.

// Minimal TripDetail type for live tracking (kept local to avoid circular imports)
export type TripDetail = {
  trip: {
    id: string
    departureAt: string | null
    arrivalAt: string | null
    departureTime: string | null
    arrivalTime: string | null
    driverName: string | null
  }
  route: {
    id: string
    name: string
    /** Not emitted by the current API — the tracker falls back to a
     *  straight endpoint line when absent. */
    geometry?: [number, number][] | null | undefined
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
    name?: string | null
    capacity?: number | null
    vehicleType: string
    vehicleTypeLabel: string
  }
  pickupPoints: {
    id: string
    name: string
    stopOrder: number
    etaOffsetMin?: number
    lat: number | null
    lon: number | null
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
