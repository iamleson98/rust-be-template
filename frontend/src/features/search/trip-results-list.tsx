'use client'

import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, ChevronDown, Loader2, X } from 'lucide-react'
import type { TripResult } from '@/api'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
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
  /** Every trip loaded so far, before the client-side filters. */
  results: TripResult[]
  filtered: TripResult[]
  hasActiveFilters: boolean
  onResetFilters: () => void
  /** from/to are set but no date: the query is idle. */
  awaitingDate: boolean
  pagination: Pagination
}

/**
 * The results column: skeletons while loading, an explanatory empty state, or the trip cards,
 * each followed by "load more" while the server has further pages. The list is free height and
 * the page scrolls. Filters apply to the loaded trips only, so the empty state offers the next
 * page too: it may hold matches.
 */
export function TripResultsList({
  loading,
  results,
  filtered,
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

  if (filtered.length === 0) {
    const [title, hint] = awaitingDate
      ? ['searchPage.pickDateTitle', 'searchPage.pickDateHint']
      : results.length === 0
        ? ['searchPage.noTripsFound', 'searchPage.noTripsHint']
        : ['searchPage.noTripsMatchFilters', 'searchPage.noMatchHint']
    return (
      <div className="rounded-xl border bg-white p-10 text-center">
        <AlertCircle className="mx-auto mb-3 h-10 w-10 text-amber-500" />
        <h3 className="text-lg font-semibold">{t(title)}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{t(hint)}</p>
        {results.length > 0 && hasActiveFilters && (
          <Button
            onClick={onResetFilters}
            variant="outline"
            className="mt-4 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50"
          >
            <X className="h-4 w-4" />
            {t('searchPage.clearAllFilters')}
          </Button>
        )}
        {pagination.hasMore && (
          <div className="mt-4">
            <LoadMore pagination={pagination} showing={results.length} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filtered.map((trip, i) => (
        <TripCard
          key={trip.tripId}
          trip={trip}
          onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: trip.tripId } })}
          isRecommended={i === 0 && filtered.length > 1}
        />
      ))}
      {pagination.hasMore && <LoadMore pagination={pagination} showing={results.length} />}
    </div>
  )
}
