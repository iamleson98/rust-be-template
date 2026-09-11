'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ═══════════════════════════════════════════════════════════════════
 * Admin panel loading skeletons — every admin page's data-loading
 * state renders one of these STRUCTURE-MATCHED placeholders (shapes
 * mirror the loaded layout of the panel it replaces), never a data
 * table with skeleton fillers and never plain zero-value cards.
 * None of them use shadows — admin surfaces stay flat (border only).
 * ═══════════════════════════════════════════════════════════════════ */

/* ─── Admin Stats Cards Skeleton — KPI / stat card row ───
 * Mirrors the stats rows on the reviews / payments / chat panels:
 * a responsive card grid where each card = icon + label, big value,
 * optional sub-line. Used while the stats query loads so no zero
 * values flash.
 */
export const AdminStatsCardsSkeleton = memo(function AdminStatsCardsSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <div
      className={count <= 3 ? 'grid gap-4 md:grid-cols-3' : 'grid gap-3 sm:grid-cols-2 lg:grid-cols-4'}
      aria-hidden
      data-testid="admin-stats-skeleton"
    >
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border bg-card py-6">
          <div className="space-y-3 px-6">
            <div className="flex items-center gap-2">
              <Shimmer className="h-3.5 w-3.5 rounded" />
              <Shimmer className="h-3.5 w-24" />
            </div>
            <Shimmer className="h-8 w-24" />
            <Shimmer className="h-3 w-32" style={{ opacity: 1 - i * 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  )
})
