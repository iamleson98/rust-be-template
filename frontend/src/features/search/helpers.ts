/**
 * Shared types + helpers for the search-results module.
 *
 * Extracted from the original `search-results.tsx` so the filter panel,
 * filter sidebar, mobile filter sheet, active-filter chips and the results
 * list can each live in its own file under `features/search/`.
 */

import type { TripResult } from '@/lib/store'
import type { UseNavigateResult } from '@tanstack/react-router'

export type TimeRange = '0-6' | '6-12' | '12-18' | '18-24'

export type Filters = {
  priceMin: number
  priceMax: number
  timeRanges: TimeRange[]
  minRating: number
  availableOnly: boolean
  amenities: string[]
  /** Brand slugs to include (empty = all brands). */
  brands: string[]
}

/** Shape of the typed search params coming from the /search route. */
export type RouteSearch = {
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
  // Smart-search coordinates (optional) — present when From/To were
  // picked as precise places; drives the geo proximity search.
  fromLat?: number
  fromLon?: number
  toLat?: number
  toLon?: number
  // City-level fallback names (a precise pick's province) for mixed picks.
  fromCity?: string
  toCity?: string
}

/** True when the search carries a full precise pickup+drop coordinate pair. */
export function isSmartSearch(s: RouteSearch): boolean {
  return [s.fromLat, s.fromLon, s.toLat, s.toLon].every(
    (v) => typeof v === 'number' && Number.isFinite(v),
  )
}

export type NavigateFn = UseNavigateResult<string>

/** Sort options rendered by the filter sidebar + mobile filter sheet.
 * Labels are i18n keys — translated at render time by the consumers. */
export const sortOptions: {
  key: 'departure' | 'price' | 'rating'
  labelKey: string
  icon: string
}[] = [
  { key: 'departure', labelKey: 'searchPage.departureTime', icon: '🕐' },
  { key: 'price', labelKey: 'searchPage.sortCheapest', icon: '💰' },
  { key: 'rating', labelKey: 'searchPage.rating', icon: '⭐' },
]

export function getHourOfDeparture(t: TripResult): number {
  // Try departureAt first; fallback to parsing departureTime"HH:mm"
  if (t.departureAt) {
    const d = new Date(t.departureAt)
    const h = d.getHours()
    if (!Number.isNaN(h)) return h
  }
  const m = /(\d{1,2}):(\d{2})/.exec(t.departureTime ?? '')
  return m ? parseInt(m[1], 10) : 12
}

export function matchesTimeRange(hour: number, range: TimeRange): boolean {
  const [start, end] = range.split('-').map(Number)
  return hour >= start && hour < end
}
