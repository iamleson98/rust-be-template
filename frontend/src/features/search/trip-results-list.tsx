'use client'

import { useRef } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AlertCircle, X } from 'lucide-react'
import type { TripResult } from '@/api'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { TripCard } from './trip-card'
import { TripCardSkeleton } from './trip-card-skeleton'

/** Beyond this many results the list is virtualized; below it the overhead isn't worth it. */
const VIRTUALIZE_ABOVE = 30

/** The results column: skeletons while loading, an explanatory empty state, or the trip cards. */
export function TripResultsList({
  loading,
  results,
  filtered,
  hasActiveFilters,
  onResetFilters,
  awaitingDate,
}: {
  loading: boolean
  results: TripResult[]
  filtered: TripResult[]
  hasActiveFilters: boolean
  onResetFilters: () => void
  /** from/to are set but no date: the query is idle. */
  awaitingDate: boolean
}) {
  const t = useT()
  const navigate = useNavigate()
  const parentRef = useRef<HTMLDivElement>(null)
  const virtual = filtered.length > VIRTUALIZE_ABOVE
  const virtualizer = useVirtualizer({
    count: virtual ? filtered.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200,
    overscan: 4,
    enabled: virtual,
  })

  const card = (trip: TripResult, index: number) => (
    <TripCard
      key={trip.tripId}
      trip={trip}
      onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: trip.tripId } })}
      isRecommended={index === 0 && filtered.length > 1}
    />
  )

  if (loading) {
    return (
      <div className="space-y-3">
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

  if (!virtual) return <div className="space-y-3">{filtered.map(card)}</div>

  return (
    <div className="space-y-3">
      <div ref={parentRef} className="max-h-[80vh] overflow-y-auto">
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualizer.getVirtualItems().map((row) => (
            <div
              key={filtered[row.index].tripId}
              data-index={row.index}
              ref={virtualizer.measureElement}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${row.start}px)`,
              }}
              className="pb-3"
            >
              {card(filtered[row.index], row.index)}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
