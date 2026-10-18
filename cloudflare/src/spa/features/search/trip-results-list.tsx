'use client'

import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, ChevronDown, Loader2, X } from 'lucide-react'
import type { TripResult } from '@spa/api'
import { Button } from '@spa/components/ui/button'
import { useT } from '@spa/lib/i18n'
import { TripCard } from './trip-card'
import { TripCardSkeleton } from './trip-card-skeleton'

export type Pagination = {
  /** The server has more matching trips past the loaded pages. */
  hasMore: boolean
  loadingMore: boolean
  onLoadMore: () => void
  /** Matching trips across all pages. */
  total: number
}

/** "Load more" button with a showing-X-of-Y line. */
function LoadMore({ pagination, showing }: { pagination: Pagination; showing: number }) {
  const t = useT()
  const { loadingMore, onLoadMore, total } = pagination
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

type Props = {
  /** First fetch, or a re-search while the previous results are still on screen. */
  loading: boolean
  /** The trips loaded so far (the server applied the filters). */
  results: TripResult[]
  /** Trips the search found before the filters. */
  matches: number
  /** Cheapest seat among every match, for the "cheapest" badge. */
  cheapest?: number
  hasActiveFilters: boolean
  onResetFilters: () => void
  /** from/to are set but no date: the query is idle. */
  awaitingDate: boolean
  pagination: Pagination
}

/**
 * The results column: skeletons while loading, an explanatory empty state, or the trip cards,
 * followed by "load more" while the server has further pages. The list is free height and the
 * page scrolls.
 */
export function TripResultsList({
  loading,
  results,
  matches,
  cheapest,
  hasActiveFilters,
  onResetFilters,
  awaitingDate,
  pagination,
}: Props) {
  const t = useT()
  const navigate = useNavigate()

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-live="polite">
        {Array.from({ length: 4 }, (_, i) => (
          <TripCardSkeleton key={i} />
        ))}
      </div>
    )
  }

  if (results.length === 0) {
    const filteredOut = matches > 0 && hasActiveFilters
    const [title, hint] = awaitingDate
      ? ['searchPage.pickDateTitle', 'searchPage.pickDateHint']
      : filteredOut
        ? ['searchPage.noTripsMatchFilters', 'searchPage.noMatchHint']
        : ['searchPage.noTripsFound', 'searchPage.noTripsHint']
    return (
      <div className="rounded-2xl bg-white px-6 py-12 text-center shadow-soft ring-1 ring-slate-200/80">
        <span className="mx-auto mb-4 grid size-14 place-items-center rounded-full bg-amber-50 text-amber-500">
          <AlertCircle className="size-7" />
        </span>
        <h3 className="text-lg font-semibold text-slate-900">{t(title)}</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{t(hint)}</p>
        {filteredOut && (
          <Button
            onClick={onResetFilters}
            variant="outline"
            className="mt-4 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <X className="h-4 w-4" />
            {t('searchPage.clearAllFilters')}
          </Button>
        )}
      </div>
    )
  }

  // "Cheapest" for the one loaded trip at the lowest fare of every match.
  const atLowest = results.filter((r) => r.minPrice === cheapest)
  const cheapestId = matches > 1 && atLowest.length === 1 ? atLowest[0].tripId : null

  return (
    <div className="space-y-3">
      {results.map((trip) => (
        <TripCard
          key={trip.tripId}
          trip={trip}
          onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: trip.tripId } })}
          cheapest={trip.tripId === cheapestId}
        />
      ))}
      {pagination.hasMore && <LoadMore pagination={pagination} showing={results.length} />}
    </div>
  )
}
