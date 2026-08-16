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
  sort?: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes?: string[]
  roundTrip?: boolean
  returnDate?: string
}

/** The /search route's validated search shape (all optional for clean URLs). */
export type SearchRouteOutput = Partial<{
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
  vt: string
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
  return out
}
