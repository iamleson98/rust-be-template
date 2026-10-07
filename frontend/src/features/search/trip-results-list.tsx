'use client'

/**
 * TripResultsList — the results column of the search-results page:
 * skeleton loading state, the per-filter empty state, and the trip list
 * itself. Also pre-computes the top-rated / cheapest flags for the
 * recommended badge.
 *
 * FREE-HEIGHT LIST: the list grows naturally and the PAGE scrolls — no
 * inner `max-h-*` + `overflow-y-auto` container (the old virtualized
 * branch capped the list at 80vh, which looked like a scroll-box glued
 * inside the page). Virtualization was removed entirely: the backend
 * caps searches at 100 trips, and memoized cards at that scale render
 * fine — the virtualizer's absolute-positioning + own scroll container
 * cost more (in layout complexity and UX) than it saved.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { useMemo } from 'react'
import type { TripResult } from '@/lib/store'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { TripCard } from '@/features/search/trip-card'
import { TripCardSkeleton } from './trip-card-skeleton'
import type { NavigateFn } from './helpers'

export function TripResultsList({
  searchLoading,
  searchResults,
  filteredResults,
  activeFilterCount,
  resetFilters,
  navigate,
  awaitingDate = false,
}: {
  /** True on the FIRST fetch AND on every re-search in flight (the
   *  caller merges isLoading/isPlaceholderData) — skeletons replace the
   *  list so a re-search visibly resets instead of showing stale trips. */
  searchLoading: boolean
  searchResults: TripResult[]
  filteredResults: TripResult[]
  activeFilterCount: number
  resetFilters: () => void
  navigate: NavigateFn
  /** True when from/to are set but no date — the query is disabled. */
  awaitingDate?: boolean
}) {
  const t = useT()
  // Pre-compute top-rated / cheapest flags once for the recommended badge
  // (avoids O(n²) Math.max/Math.min inside the render loop).
  const { topRating, cheapestPrice } = useMemo(() => {
    if (filteredResults.length === 0) return { topRating: 0, cheapestPrice: 0 }
    let topRating = -Infinity
    let cheapestPrice = Infinity
    for (const r of filteredResults) {
      if (r.brandRating > topRating) topRating = r.brandRating
      if (r.minPrice < cheapestPrice) cheapestPrice = r.minPrice
    }
    return { topRating, cheapestPrice }
  }, [filteredResults])

  return searchLoading ? (
    <div className="space-y-3" aria-busy="true" aria-live="polite">
      {Array.from({ length: 4 }).map((_, i) => (
        <TripCardSkeleton key={i} />
      ))}
    </div>
  ) : filteredResults.length === 0 ? (
    <div className="rounded-xl border bg-white p-10 text-center">
      <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
      <h3 className="font-semibold text-lg">
        {awaitingDate
          ? t('searchPage.pickDateTitle')
          : searchResults.length === 0
            ? t('searchPage.noTripsFound')
            : t('searchPage.noTripsMatchFilters')}
      </h3>
      <p className="text-sm text-muted-foreground mt-1">
        {awaitingDate
          ? t('searchPage.pickDateHint')
          : searchResults.length === 0
            ? t('searchPage.noTripsHint')
            : t('searchPage.noMatchHint')}
      </p>
      {searchResults.length > 0 && activeFilterCount > 0 && (
        <Button
          onClick={resetFilters}
          variant="outline"
          className="mt-4 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
        >
          <X className="h-4 w-4" />
          {t('searchPage.clearAllFilters')}
        </Button>
      )}
    </div>
  ) : (
    /* Free height — the page scrolls; no inner scroll container. */
    <div className="space-y-3">
      {filteredResults.map((t, i) => {
        // Determine recommended: trip with highest rating AND lowest price in results
        const isTopRated = t.brandRating === topRating
        const isCheapest = t.minPrice === cheapestPrice
        const isRecommended = i === 0 || (isTopRated && isCheapest)
        return (
          <TripCard
            key={t.tripId}
            trip={t}
            onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })}
            isRecommended={filteredResults.length > 1 && isRecommended && i === 0}
          />
        )
      })}
    </div>
  )
}
