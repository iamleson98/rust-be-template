'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Brand List Skeleton — brand management rows ───
 * Mirrors the brand list rows: colored logo square + name/badges +
 * rating/route-count meta line + the two edit/delete icon buttons.
 */
export const BrandListSkeleton = memo(function BrandListSkeleton({
  count = 5,
}: {
  count?: number
}) {
  return (
    <div className="divide-y" aria-hidden data-testid="brand-list-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-start gap-2.5 p-3">
          <Shimmer className="h-9 w-9 rounded-lg shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-3.5 w-10 rounded" />
            </div>
            <Shimmer className="h-3 w-36" style={{ opacity: 1 - i * 0.12 }} />
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
