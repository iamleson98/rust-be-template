'use client'

import { useNavigate } from '@tanstack/react-router'
import { AlertCircle, X } from 'lucide-react'
import type { TripResult } from '@/api'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { TripCard } from './trip-card'
import { TripCardSkeleton } from './trip-card-skeleton'

type Props = {
  /** First fetch, or a re-search while the previous results are still on screen. */
  loading: boolean
  results: TripResult[]
  filtered: TripResult[]
  hasActiveFilters: boolean
  onResetFilters: () => void
  /** from/to are set but no date: the query is idle. */
  awaitingDate: boolean
}

/**
 * The results column: skeletons while loading, an explanatory empty state, or the trip cards.
 * The list is free height and the page scrolls; the backend caps a search at 100 trips,
 * which memoised cards render without virtualisation.
 */
export function TripResultsList({
  loading,
  results,
  filtered,
  hasActiveFilters,
  onResetFilters,
  awaitingDate,
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
    </div>
  )
}
