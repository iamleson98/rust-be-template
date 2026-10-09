import type { TripResult } from '@/api'

export type TimeRange = '0-6' | '6-12' | '12-18' | '18-24'

/** Client-side result filters (the URL carries only sort, vehicle types and the query itself). */
export type Filters = {
  /** 0 means "no lower bound chosen" — the range then follows the results. */
  priceMin: number
  priceMax: number
  timeRanges: TimeRange[]
  minRating: number
  availableOnly: boolean
  amenities: string[]
  /** Brand slugs to include (empty = all brands). */
  brands: string[]
}

export type PriceRange = [number, number]

export const NO_FILTERS: Filters = {
  priceMin: 0,
  priceMax: 0,
  timeRanges: [],
  minRating: 0,
  availableOnly: false,
  amenities: [],
  brands: [],
}

/** "Plenty of seats" threshold of the availability filter. */
export const FEW_SEATS = 5
const PRICE_STEP = 50_000

export function departureHour(trip: TripResult): number {
  if (trip.departureAt) {
    const hour = new Date(trip.departureAt).getHours()
    if (!Number.isNaN(hour)) return hour
  }
  const m = /(\d{1,2}):(\d{2})/.exec(trip.departureTime ?? '')
  return m ? parseInt(m[1], 10) : 12
}

export function inTimeRange(hour: number, range: TimeRange): boolean {
  const [start, end] = range.split('-').map(Number)
  return hour >= start && hour < end
}

/** Cheapest/dearest price across the results, rounded out to the slider step. */
export function priceBounds(results: TripResult[]): PriceRange {
  if (results.length === 0) return [0, 1_000_000]
  const min = Math.min(...results.map((r) => r.minPrice))
  const max = Math.max(...results.map((r) => r.maxPrice))
  return [Math.floor(min / PRICE_STEP) * PRICE_STEP, Math.ceil(max / PRICE_STEP) * PRICE_STEP]
}

/** The selected price range, clamped into the bounds. */
export function effectiveRange(f: Filters, [lo, hi]: PriceRange): PriceRange {
  return [
    f.priceMin === 0 || f.priceMin < lo ? lo : f.priceMin,
    f.priceMax === 0 || f.priceMax > hi ? hi : f.priceMax,
  ]
}

export function applyFilters(
  results: TripResult[],
  f: Filters,
  [pLo, pHi]: PriceRange,
): TripResult[] {
  return results.filter((r) => {
    if (r.minPrice < pLo || r.minPrice > pHi) return false
    if (f.timeRanges.length && !f.timeRanges.some((t) => inTimeRange(departureHour(r), t)))
      return false
    if (f.minRating > 0 && r.brandRating < f.minRating) return false
    if (f.brands.length && !f.brands.includes(r.brandSlug)) return false
    if (f.availableOnly && r.availableSeats <= FEW_SEATS) return false
    // `?? []`: minimal trip rows may arrive before enrichment fills amenities.
    return f.amenities.every((a) => (r.amenities ?? []).includes(a))
  })
}

/** How many filter chips are active (a price range counts once, the rest per value). */
export function activeFilterCount(f: Filters, range: PriceRange, bounds: PriceRange): number {
  const priceActive = range[0] > bounds[0] || range[1] < bounds[1]
  return (
    Number(priceActive) +
    f.timeRanges.length +
    Number(f.minRating > 0) +
    f.brands.length +
    Number(f.availableOnly) +
    f.amenities.length
  )
}

export const toggle = <T>(list: T[], item: T): T[] =>
  list.includes(item) ? list.filter((x) => x !== item) : [...list, item]

/** Distinct brands of the results, busiest first. */
export function brandOptions(results: TripResult[]) {
  const bySlug = new Map<string, { slug: string; name: string; count: number }>()
  for (const r of results) {
    if (!r.brandSlug) continue
    const entry = bySlug.get(r.brandSlug)
    if (entry) entry.count++
    else bySlug.set(r.brandSlug, { slug: r.brandSlug, name: r.brandName || r.brandSlug, count: 1 })
  }
  return [...bySlug.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export const count = <T>(items: T[], pred: (item: T) => boolean) => items.filter(pred).length
