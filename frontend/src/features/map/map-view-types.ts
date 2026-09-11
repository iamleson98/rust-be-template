// Extracted from the original 'map-view.tsx'.

// ── Types ─────────────────────────────────────────────────
export type Place = {
  id: string
  name: string
  type: string
  province: string | null
  lat: number
  lon: number
  population: number
}

export type RouteItem = {
  id: string
  slug: string
  name: string
  code: string
  brand: { name: string; slug: string; accentColor: string; logoUrl: string | null; rating: number }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  scheduleCount: number
  minPrice: number
  maxPrice: number
}
