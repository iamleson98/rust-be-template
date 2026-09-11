'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Route List Skeleton — route management rows ───
 * Mirrors the route list rows: route name + city meta line + the
 * schedule count chip + edit/delete icon buttons.
 */
export const RouteListSkeleton = memo(function RouteListSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="route-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 p-3">
          <Shimmer className="h-8 w-8 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-4 w-32" />
              <Shimmer className="h-4 w-14 rounded-full" />
            </div>
            <Shimmer className="h-3 w-44" style={{ opacity: 1 - i * 0.15 }} />
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
