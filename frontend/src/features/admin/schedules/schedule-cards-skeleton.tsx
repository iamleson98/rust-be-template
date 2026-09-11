'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Admin Schedule Cards Skeleton ───
 * Mirrors the schedules page card: a two-column body (left = time +
 * stops + amenities chips; right = price block + status + actions)
 * on a bordered card surface.
 */
export const AdminScheduleCardsSkeleton = memo(function AdminScheduleCardsSkeleton({
  count = 2,
}: {
  count?: number
}) {
  return (
    <div className="grid gap-3" aria-hidden data-testid="admin-schedules-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
            {/* Left: trip info */}
            <div className="p-4 space-y-3">
              <div className="flex items-center gap-3">
                <Shimmer className="h-8 w-16 rounded-lg" />
                <Shimmer className="h-4 w-40" />
              </div>
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-56" />
                <Shimmer className="h-3 w-44" />
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Shimmer key={j} className="h-5 w-16 rounded-md" />
                ))}
              </div>
              <div className="flex items-center gap-3">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            {/* Right: price + actions */}
            <div className="p-4 border-t lg:border-t-0 lg:border-l space-y-2.5">
              <div className="flex items-center justify-between">
                <Shimmer className="h-7 w-24" />
                <Shimmer className="h-5 w-16 rounded-full" />
              </div>
              <div className="space-y-1.5">
                <Shimmer className="h-3 w-32" />
                <Shimmer className="h-3 w-24" />
              </div>
              <div className="flex items-center gap-2 pt-1">
                <Shimmer className="h-8 w-24 rounded-md" />
                <Shimmer className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
})
