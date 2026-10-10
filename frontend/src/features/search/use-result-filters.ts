import { useMemo, useState } from 'react'
import type { TripResult } from '@/api'
import {
  activeFilterCount,
  applyFilters,
  effectiveRange,
  NO_FILTERS,
  priceBounds,
  type Filters,
} from './filters'

/** Client-side filtering of one result set: the selection, the derived price range and the filtered list. */
export function useResultFilters(results: TripResult[]) {
  const bounds = useMemo(() => priceBounds(results), [results])
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)

  // A new search moves the price bounds: forget the old price pick (render-phase sync).
  const boundsKey = bounds.join('-')
  const [lastKey, setLastKey] = useState(boundsKey)
  if (boundsKey !== lastKey) {
    setLastKey(boundsKey)
    if (filters.priceMin || filters.priceMax)
      setFilters((f) => ({ ...f, priceMin: 0, priceMax: 0 }))
  }

  const range = useMemo(() => effectiveRange(filters, bounds), [filters, bounds])
  const filtered = useMemo(() => applyFilters(results, filters, range), [results, filters, range])

  return {
    filters,
    setFilters,
    reset: () => setFilters(NO_FILTERS),
    bounds,
    range,
    filtered,
    activeCount: activeFilterCount(filters, range, bounds),
  }
}

export type ResultFilters = ReturnType<typeof useResultFilters>
