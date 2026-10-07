'use client'

/**
 * TripResultsList — the results column of the search-results page:
 * skeleton loading state, the per-filter empty state, the trip list
 * itself, and the "load more" pagination tail. Also pre-computes the
 * top-rated / cheapest flags for the recommended badge.
 *
 * FREE-HEIGHT LIST: the list grows naturally and the PAGE scrolls — no
 * inner `max-h-*` + `overflow-y-auto` container (the old virtualized
 * branch capped the list at 80vh, which looked like a scroll-box glued
 * inside the page). Virtualization was removed entirely: the backend
 * now paginates (`limit` + `offset`, 10 per page — see
 * `useTripSearchInfinite`), so the DOM only ever holds what the user
 * actually asked to see.
 *
 * PAGINATION: when the server says more matching trips exist
 * (`hasMore`), a "load more" button sits at the end of the list — one
 * click appends the next page (the user never has to guess whether
 * the list silently stopped). It also renders in the filtered-empty
 * state: with client-side filters active, later pages may still
 * contain matching trips.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { useMemo } from 'react'
import type { TripResult } from '@/lib/store'
import { AlertCircle, ChevronDown, Loader2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { TripCard } from '@/features/search/trip-card'
import { TripCardSkeleton } from './trip-card-skeleton'
import type { NavigateFn } from './helpers'

/** The pagination tail: "load more" button + a showing-X-of-Y line.
 *  Rendered at the end of the trip list AND in the filtered-empty
 *  state (later pages may contain trips the current filters match). */
function LoadMoreTail({
  hasMore,
  loadingMore,
  onLoadMore,
  showing,
  total,
}: {
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  showing: number
  total: number
}) {
  const t = useT()
  if (!hasMore) return null
  const remaining = Math.max(total - showing, 0)
  return (
    <div className="mt-1 flex flex-col items-center gap-2 py-2" data-testid="load-more-tail">
      <Button
        variant="outline"
        size="lg"
        onClick={onLoadMore}
        disabled={loadingMore}
        data-testid="load-more-button"
        className="w-full max-w-xs gap-2 rounded-xl border-blue-200 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
      >
        {loadingMore ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{t('searchPage.loadingMore')}</span>
          </>
        ) : (
          <>
            <ChevronDown className="h-4 w-4" />
            <span>
              {remaining > 0
                ? t('searchPage.loadMoreRemaining', { count: remaining })
                : t('searchPage.loadMore')}
            </span>
          </>
        )}
      </Button>
      {total > 0 && (
        <p className="text-xs text-muted-foreground">
          {t('searchPage.showingOf', { showing, total })}
        </p>
      )}
    </div>
  )
}

export function TripResultsList({
  searchLoading,
  searchResults,
  filteredResults,
  activeFilterCount,
  resetFilters,
  navigate,
  awaitingDate = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  totalTrips = 0,
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
  /** Server says more matching trips exist past the loaded pages. */
  hasMore?: boolean
  /** A "load more" request is in flight. */
  loadingMore?: boolean
  /** Appends the next page to the list. */
  onLoadMore?: () => void
  /** Server-truth total matching trips (across ALL pages). */
  totalTrips?: number
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
      {/* Filters can hide every LOADED trip while later pages still
          contain matches — offer the next page right here. */}
      {hasMore && onLoadMore && (
        <div className="mt-4">
          <LoadMoreTail
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={onLoadMore}
            showing={searchResults.length}
            total={totalTrips}
          />
        </div>
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
      {hasMore && onLoadMore && (
        <LoadMoreTail
          hasMore={hasMore}
          loadingMore={loadingMore}
          onLoadMore={onLoadMore}
          showing={searchResults.length}
          total={totalTrips}
        />
      )}
    </div>
  )
}
