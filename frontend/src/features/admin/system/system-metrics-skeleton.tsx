'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Admin System Metrics Skeleton ───
 * Mirrors the /admin/system "Server Metrics" section's loaded layout:
 * the 3-card CPU / Memory / This Process row, the full-width Disks
 * card (two volume rows) and the Host footer's 4-column field grid.
 * Shown while the first metrics snapshot loads — a structure-matched
 * skeleton, never a data table.
 */
export const SystemMetricsSkeleton = memo(function SystemMetricsSkeleton() {
  return (
    <div className="space-y-3" aria-hidden data-testid="system-metrics-skeleton">
      {/* CPU / Memory / This Process card row */}
      <div className="grid gap-4 md:grid-cols-3">
        {[0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card py-6">
            <div className="space-y-3 px-6">
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-3 w-36" />
              <Shimmer className="h-8 w-28" />
              <Shimmer className="h-2 w-full rounded-full" />
              <Shimmer className="h-2 w-2/3 rounded-full" style={{ opacity: 1 - i * 0.12 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Disks card */}
      <div className="space-y-3 rounded-xl border bg-card px-6 py-6">
        <Shimmer className="h-4 w-20" />
        {[0, 1].map((i) => (
          <div key={i} className="space-y-1.5">
            <Shimmer className="h-4 w-56" style={{ opacity: 1 - i * 0.15 }} />
            <Shimmer className="h-2 w-full rounded-full" style={{ opacity: 1 - i * 0.15 }} />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.15 }} />
          </div>
        ))}
      </div>

      {/* Host footer card */}
      <div className="rounded-xl border bg-card px-6 py-6">
        <Shimmer className="mb-3 h-4 w-16" />
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-1.5">
              <Shimmer className="h-3 w-16" />
              <Shimmer className="h-4 w-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
})
