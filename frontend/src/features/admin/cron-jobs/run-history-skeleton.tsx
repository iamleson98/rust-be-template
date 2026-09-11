'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Run History Skeleton — history card rows ───
 * Mirrors the "Lịch sử chạy" card: header title + 5 compact rows
 * (status dot + job code + duration + timestamp), not a data table.
 */
export const RunHistorySkeleton = memo(function RunHistorySkeleton({
  rows = 5,
}: {
  rows?: number
}) {
  return (
    <div className="p-4 space-y-2.5" aria-hidden data-testid="run-history-skeleton">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <Shimmer className="h-2.5 w-2.5 rounded-full" />
          <Shimmer className="h-4 w-28" />
          <Shimmer className="h-4 w-20 hidden sm:block" />
          <div className="flex-1" />
          <Shimmer className="h-4 w-16" />
          <Shimmer className="h-4 w-24" style={{ opacity: 1 - i * 0.12 }} />
        </div>
      ))}
    </div>
  )
})
