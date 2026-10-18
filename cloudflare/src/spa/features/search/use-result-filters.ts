import { useMemo, useState } from 'react'
import type { SearchFacets } from '@spa/api'
import { activeFilterCount, effectiveRange, NO_FILTERS, priceBounds, type Filters } from './filters'

/**
 * The results page's filters: what is picked, and the price range the slider
 * shows against every match's prices (`facets`). The server does the
 * filtering; the state lives in the page so the query can read it before the
 * results (and their facets) arrive.
 */
export function useResultFilters(
  filters: Filters,
  setFilters: (filters: Filters) => void,
  facets: SearchFacets | undefined,
) {
  const bounds = useMemo(() => priceBounds(facets), [facets])

  // A new search moves the price bounds: forget the old price pick (render-phase sync).
  const boundsKey = bounds.join('-')
  const [lastKey, setLastKey] = useState(boundsKey)
  if (boundsKey !== lastKey) {
    setLastKey(boundsKey)
    if (filters.priceMin || filters.priceMax) setFilters({ ...filters, priceMin: 0, priceMax: 0 })
  }

  const range = useMemo(() => effectiveRange(filters, bounds), [filters, bounds])

  return {
    filters,
    setFilters,
    reset: () => setFilters(NO_FILTERS),
    bounds,
    range,
    facets,
    activeCount: activeFilterCount(filters, range, bounds),
  }
}

export type ResultFilters = ReturnType<typeof useResultFilters>
