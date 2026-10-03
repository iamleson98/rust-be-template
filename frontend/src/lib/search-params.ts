/**
 * Helper for building clean `/search` route navigation params.
 *
 * The /search route's `validateSearch` returns ONLY keys that have
 * meaningful values (all fields optional). This helper mirrors that
 * pattern: it includes only non-default params so the URL stays clean.
 *
 * Usage:
 *   navigate({ to: '/search', search: buildSearchInput({ from, to, date }) })
 *   <Link to="/search" search={buildSearchInput({ from, to, date })}>
 */
export type SearchRouteParams = {
  from?: string
  to?: string
  date?: string
  adults?: number
  children?: number
  sort?: 'departure' | 'price' | 'rating'
  vehicleTypes?: string[]
  roundTrip?: boolean
  returnDate?: string
  // Smart-search coordinates (precise place picks / map clicks).
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  // City-level fallback names for precise picks (place's province) —
  // used when only ONE end carries coordinates.
  fromCity?: string
  toCity?: string
}

/** The /search route's validated search shape (all optional for clean URLs). */
export type SearchRouteOutput = Partial<{
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
  vt: string
  fromLat: number
  fromLon: number
  toLat: number
  toLon: number
  fromCity: string
  toCity: string
}>

/** Build clean /search navigation params — includes only non-default values. */
export function buildSearchInput(p: SearchRouteParams): SearchRouteOutput {
  const out: SearchRouteOutput = {}
  if (p.from) out.from = p.from
  if (p.to) out.to = p.to
  if (p.date) out.date = p.date
  if (p.adults && p.adults !== 1) out.adults = p.adults
  if (p.children && p.children !== 0) out.children = p.children
  if (p.sort && p.sort !== 'departure') out.sort = p.sort
  if (p.vehicleTypes && p.vehicleTypes.length > 0) {
    out.vehicleTypes = p.vehicleTypes
  }
  if (p.roundTrip) out.roundTrip = true
  if (p.returnDate) out.returnDate = p.returnDate
  // Smart-search coordinates — only when ALL FOUR are valid numbers (a
  // half-picked state never produces a geo query).
  const geo =
    typeof p.fromLat === 'number' &&
    Number.isFinite(p.fromLat) &&
    typeof p.fromLon === 'number' &&
    Number.isFinite(p.fromLon) &&
    typeof p.toLat === 'number' &&
    Number.isFinite(p.toLat) &&
    typeof p.toLon === 'number' &&
    Number.isFinite(p.toLon)
  if (geo) {
    out.fromLat = p.fromLat
    out.fromLon = p.fromLon
    out.toLat = p.toLat
    out.toLon = p.toLon
    return out
  }

  // MIXED pick (one end precise, the other a plain city): the geo search
  // needs both points, so degrade the precise end to its CITY (the place's
  // province) and run the ordinary city-to-city search instead of
  // returning nothing for an unresolvable place name.
  if (typeof p.fromLat === 'number' || typeof p.toLat === 'number') {
    if (p.fromCity) out.from = p.fromCity
    if (p.toCity) out.to = p.toCity
  }
  return out
}
