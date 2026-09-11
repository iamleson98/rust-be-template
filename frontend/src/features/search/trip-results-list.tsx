'use client'

/**
 * TripResultsList — the results column of the search-results page:
 * skeleton loading state, the per-filter empty state, and the trip list
 * itself (plain list, or virtualized via @tanstack/react-virtual once it
 * grows past ~30 items). Also pre-computes the top-rated / cheapest flags
 * for the recommended badge.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { useMemo, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TripResult } from '@/lib/store'
import { AlertCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
}: {
  searchLoading: boolean
  searchResults: TripResult[]
  filteredResults: TripResult[]
  activeFilterCount: number
  resetFilters: () => void
  navigate: NavigateFn
}) {
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

  // Virtualize the trip list when it grows past ~30 items — otherwise the
  // overhead of the virtualizer (ResizeObserver + absolute positioning)
  // isn't worth the perf win for typical ~12-result pages.
  const TRIP_VIRTUAL_THRESHOLD = 30
  const shouldVirtualize = filteredResults.length > TRIP_VIRTUAL_THRESHOLD
  const listParentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? filteredResults.length : 0,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 200,
    overscan: 4,
    enabled: shouldVirtualize,
  })

  return (
    searchLoading ? (
      <div className="space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <TripCardSkeleton key={i} />
        ))}
      </div>
    ) : filteredResults.length === 0 ? (
      <div



        className="rounded-xl border bg-white p-10 text-center"
      >
        <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h3 className="font-semibold text-lg">
          {searchResults.length === 0 ? 'Không tìm thấy chuyến' : 'Không có chuyến phù hợp bộ lọc'}
        </h3>
        <p className="text-sm text-muted-foreground mt-1">
          {searchResults.length === 0
            ? 'Thử đổi ngày đi, điểm đi/đến hoặc bỏ bớt bộ lọc loại xe.'
            : 'Thử nới lỏng khoảng giá, đánh giá hoặc bỏ bớt bộ lọc tiện ích.'}
        </p>
        {searchResults.length > 0 && activeFilterCount > 0 && (
          <Button onClick={resetFilters} variant="outline" className="mt-4 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50">
            <X className="h-4 w-4" />
            Xoá tất cả bộ lọc
          </Button>
        )}
      </div>
    ) : (
      <div className="space-y-3">
        {shouldVirtualize ? (
          <div ref={listParentRef} className="max-h-[80vh] overflow-y-auto">
            <div
              style={{
                height: `${virtualizer.getTotalSize()}px`,
                position: 'relative',
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const t = filteredResults[virtualRow.index]
                const isTopRated = t.brandRating === topRating
                const isCheapest = t.minPrice === cheapestPrice
                const isRecommended = virtualRow.index === 0 || (isTopRated && isCheapest)
                return (
                  <div
                    key={t.tripId}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="pb-3"
                  >
                    <TripCard trip={t} onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })} index={virtualRow.index} isRecommended={filteredResults.length > 1 && isRecommended && virtualRow.index === 0} />
                  </div>
                )
              })}
            </div>
          </div>
        ) : (
          <>
            {filteredResults.map((t, i) => {
              // Determine recommended: trip with highest rating AND lowest price in results
              const isTopRated = t.brandRating === topRating
              const isCheapest = t.minPrice === cheapestPrice
              const isRecommended = i === 0 || (isTopRated && isCheapest)
              return (
                <TripCard key={t.tripId} trip={t} onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })} index={i} isRecommended={filteredResults.length > 1 && isRecommended && i === 0} />
              )
            })}
          </>
        )}
      </div>
    )
  )
}
