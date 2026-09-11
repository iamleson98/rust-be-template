'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Schedule Mini Skeleton — compact schedule rows ───
 * Mirrors the compact schedule rows in the brands detail panel:
 * departure time + bus chip + days line + price line + icon buttons.
 */
export const ScheduleMiniSkeleton = memo(function ScheduleMiniSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="space-y-2" aria-hidden data-testid="schedule-mini-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-lg border p-2.5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1 space-y-1.5">
              <div className="flex items-center gap-1.5">
                <Shimmer className="h-5 w-14" />
                <Shimmer className="h-4 w-20 rounded" />
              </div>
              <Shimmer className="h-3 w-32" />
              <Shimmer className="h-3 w-40" style={{ opacity: 1 - i * 0.15 }} />
              <div className="flex items-center gap-3">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            <div className="flex flex-col gap-1 shrink-0">
              <Shimmer className="h-6 w-6 rounded" />
              <Shimmer className="h-6 w-6 rounded" style={{ opacity: 0.7 }} />
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})
