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
}

/** Shape of the typed search params coming from the /search route. */
export type RouteSearch = {
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
}

export type NavigateFn = UseNavigateResult<string>

/** Sort options rendered by the filter sidebar + mobile filter sheet. */
export const sortOptions: { key: 'departure' | 'price' | 'duration' | 'rating'; label: string; icon: string }[] = [
  { key: 'departure', label: 'Giờ đi', icon: '🕐' },
  { key: 'price', label: 'Giá rẻ nhất', icon: '💰' },
  { key: 'duration', label: 'Nhanh nhất', icon: '⚡' },
  { key: 'rating', label: 'Đánh giá', icon: '⭐' },
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
