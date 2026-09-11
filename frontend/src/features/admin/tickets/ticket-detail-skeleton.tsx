'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Ticket Detail Skeleton — admin booking dialog ───
 * Mirrors the ticket detail dialog body: the dashed status-management
 * card (title + action button row), then passenger info rows, then
 * the trip summary block.
 */
export const TicketDetailSkeleton = memo(function TicketDetailSkeleton() {
  return (
    <div className="space-y-4 p-4" aria-hidden data-testid="ticket-detail-skeleton">
      {/* Status management card */}
      <div className="rounded-xl border border-dashed bg-slate-50/50 p-3 space-y-2.5">
        <Shimmer className="h-3 w-28" />
        <div className="flex flex-wrap gap-1.5">
          <Shimmer className="h-8 w-24 rounded-md" />
          <Shimmer className="h-8 w-24 rounded-md" />
          <Shimmer className="h-8 w-24 rounded-md" />
        </div>
      </div>
      {/* Passenger info */}
      <div className="rounded-xl border p-4 space-y-3">
        <Shimmer className="h-4 w-32" />
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center justify-between gap-3">
            <Shimmer className="h-3.5 w-24" />
            <Shimmer className="h-3.5 w-40" style={{ opacity: 1 - i * 0.15 }} />
          </div>
        ))}
      </div>
      {/* Trip summary */}
      <div className="rounded-xl border p-4 space-y-3">
        <Shimmer className="h-4 w-24" />
        <div className="flex items-center gap-3">
          <Shimmer className="h-10 w-10 rounded-lg" />
          <div className="flex-1 space-y-1.5">
            <Shimmer className="h-4 w-44" />
            <Shimmer className="h-3 w-32" />
          </div>
          <Shimmer className="h-6 w-20 rounded-full" />
        </div>
        <div className="flex items-center justify-between">
          <Shimmer className="h-3 w-28" />
          <Shimmer className="h-3 w-20" />
        </div>
      </div>
    </div>
  )
})
