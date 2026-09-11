'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Admin System Status Skeleton ───
 * Mirrors the /admin/system "System Status" card row (Uptime /
 * WebSocket / Database). Shown while the first status snapshot loads.
 */
export const SystemStatusSkeleton = memo(function SystemStatusSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden data-testid="system-status-skeleton">
      {[0, 1, 2].map((i) => (
        <div key={i} className="rounded-xl border bg-card py-6">
          <div className="space-y-3 px-6">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="h-7 w-36" />
            <Shimmer className="h-2 w-full rounded-full" />
            <Shimmer className="h-3.5 w-full" style={{ opacity: 1 - i * 0.12 }} />
            <Shimmer className="h-3.5 w-2/3" style={{ opacity: 1 - i * 0.12 }} />
          </div>
        </div>
      ))}
    </div>
  )
})
