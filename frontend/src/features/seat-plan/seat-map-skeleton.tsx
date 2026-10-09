'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Seat Map Skeleton — ticket picker seat grid ───
 * Mirrors the seat selection step: a grid of seat squares + the
 * boarding/dropping selects + the price footer.
 */
export const SeatMapSkeleton = memo(function SeatMapSkeleton() {
  return (
    <div className="space-y-4" aria-hidden data-testid="seat-map-skeleton">
      {/* Seat grid */}
      <div className="grid grid-cols-5 sm:grid-cols-8 gap-2">
        {Array.from({ length: 16 }).map((_, i) => (
          <Shimmer
            key={i}
            className="h-10 w-full rounded-md"
            style={{ opacity: 1 - (i % 8) * 0.1 }}
          />
        ))}
      </div>
      {/* Boarding / dropping selects */}
      <div className="grid gap-3 sm:grid-cols-2">
        <Shimmer className="h-9 w-full rounded-md" />
        <Shimmer className="h-9 w-full rounded-md" />
      </div>
      {/* Price footer */}
      <div className="flex items-center justify-between">
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-6 w-20" />
      </div>
    </div>
  )
})
