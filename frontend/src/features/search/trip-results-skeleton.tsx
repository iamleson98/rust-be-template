'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Trip Results Skeleton — chat ticket picker search results ───
 * Mirrors the trip search result rows: brand + route line + meta
 * line + right-aligned price block.
 */
export const TripResultsSkeleton = memo(function TripResultsSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div className="space-y-2" aria-hidden data-testid="trip-results-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5 flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-2 w-2 rounded-full" />
              <Shimmer className="h-3.5 w-24" />
            </div>
            <Shimmer className="h-4 w-40" />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.15 }} />
          </div>
          <div className="text-right space-y-1 shrink-0">
            <Shimmer className="h-4 w-16 ml-auto" />
            <Shimmer className="h-2.5 w-10 ml-auto" />
          </div>
        </div>
      ))}
    </div>
  )
})
