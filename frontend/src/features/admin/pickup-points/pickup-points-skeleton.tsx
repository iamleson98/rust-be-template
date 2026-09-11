'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Pickup Points Skeleton — compact pickup rows ───
 * Mirrors the pickup point rows: name line + time/meta line + icon
 * buttons.
 */
export const PickupPointsSkeleton = memo(function PickupPointsSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="space-y-1.5" aria-hidden data-testid="pickup-points-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5 flex items-start gap-2">
          <Shimmer className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Shimmer className="h-3.5 w-36" />
            <Shimmer className="h-3 w-24" style={{ opacity: 1 - i * 0.15 }} />
          </div>
          <div className="flex flex-col gap-1 shrink-0">
            <Shimmer className="h-6 w-6 rounded" />
            <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
          </div>
        </div>
      ))}
    </div>
  )
})
