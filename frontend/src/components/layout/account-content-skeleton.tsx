'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Account Content Skeleton ───
 * The account pages' shape: page heading + a card grid (2 columns on
 * desktop) — each card has a header row + lines. Used inside the
 * persistent AccountShell.
 */
export const AccountContentSkeleton = memo(function AccountContentSkeleton() {
  return (
    <div className="p-3 md:p-6 space-y-4" aria-hidden>
      <div className="space-y-1.5">
        <Shimmer className="h-6 w-48" />
        <Shimmer className="h-3.5 w-72 max-w-full" />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border bg-card shadow-sm p-4 space-y-3">
            <div className="flex items-center gap-3">
              <Shimmer className="h-9 w-9 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-3 w-20" />
              </div>
            </div>
            <Shimmer className="h-3 w-full" />
            <Shimmer className="h-3 w-5/6" />
            <Shimmer className="h-3 w-2/3" />
          </div>
        ))}
      </div>
    </div>
  )
})
