'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Cron Job Cards Skeleton — job card grid ───
 * Mirrors a cron JobCard: title + code chip row, schedule subline,
 * action buttons + switch, and the two "next run / last run" boxes.
 */
export const CronJobCardsSkeleton = memo(function CronJobCardsSkeleton({
  count = 3,
}: {
  count?: number
}) {
  return (
    <div className="grid gap-3" aria-hidden data-testid="cron-jobs-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card p-4">
          {/* Title row */}
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 space-y-1.5">
              <div className="flex items-center gap-2">
                <Shimmer className="h-4 w-32" />
                <Shimmer className="h-4 w-20 rounded" />
              </div>
              <Shimmer className="h-3 w-48" />
            </div>
            <div className="flex items-center gap-2">
              <Shimmer className="h-8 w-24 rounded-md" />
              <Shimmer className="h-8 w-24 rounded-md" />
              <Shimmer className="h-5 w-9 rounded-full" />
            </div>
          </div>
          {/* Next / last run boxes */}
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {[0, 1].map((j) => (
              <div key={j} className="rounded-lg border p-3 space-y-1.5">
                <Shimmer className="h-3 w-24" />
                <Shimmer className="h-4 w-36" style={{ opacity: 1 - i * 0.15 }} />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
})
