'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/** Seat rows of the placeholder bus: two seats, the aisle, two seats. */
const ROWS = 6

/**
 * The trip dialog while it loads, laid out like the trip it becomes — the
 * same header, tabs and two panes (seats; stops and price) — so nothing
 * jumps when it arrives. Few, calm shapes; it fills the dialog's width.
 */
export const TripDetailSkeleton = memo(function TripDetailSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col" aria-hidden>
      {/* Header: operator tile, route, operator and bus */}
      <div className="flex shrink-0 items-start gap-3 border-b border-slate-200/80 px-4 pt-4 pb-3 sm:px-6">
        <Shimmer className="size-11 shrink-0 rounded-2xl" />
        <div className="min-w-0 flex-1 space-y-2 pt-1">
          <Shimmer className="h-5 w-3/5 max-w-72" />
          <Shimmer className="h-3.5 w-2/5 max-w-48" />
        </div>
      </div>

      {/* Tabs */}
      <div className="grid shrink-0 grid-cols-4 gap-3 border-b border-slate-200/80 px-4 py-3">
        {Array.from({ length: 4 }, (_, i) => (
          <Shimmer key={i} className="h-4 w-full max-w-24 justify-self-center rounded-full" />
        ))}
      </div>

      {/* Body: the two panes of the trip view */}
      <div className="grid min-h-[min(60dvh,32rem)] flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_320px] lg:grid-cols-[minmax(0,1.3fr)_420px]">
        <div className="min-w-0 p-4 md:border-r">
          <div className="mb-4 flex items-center justify-between gap-3">
            <Shimmer className="h-4 w-28" />
            <Shimmer className="h-3.5 w-20" />
          </div>
          <div className="mx-auto max-w-xs rounded-3xl border border-slate-200/80 p-4">
            <div className="space-y-2.5">
              {Array.from({ length: ROWS }, (_, row) => (
                <div key={row} className="grid grid-cols-[1fr_1fr_0.6fr_1fr_1fr] gap-2.5">
                  <Shimmer className="h-9 rounded-lg" />
                  <Shimmer className="h-9 rounded-lg" />
                  <span />
                  <Shimmer className="h-9 rounded-lg" />
                  <Shimmer className="h-9 rounded-lg" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="hidden min-w-0 space-y-5 bg-canvas p-5 md:block">
          <div className="space-y-3">
            <Shimmer className="h-3.5 w-24" />
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Shimmer className="size-3 shrink-0 rounded-full" />
                <Shimmer className="h-3.5 flex-1" />
                <Shimmer className="h-3.5 w-10" />
              </div>
            ))}
          </div>
          <Shimmer className="h-px w-full" />
          <div className="space-y-2">
            <Shimmer className="h-3.5 w-28" />
            <Shimmer className="h-11 w-full rounded-xl" />
            <Shimmer className="h-11 w-full rounded-xl" />
          </div>
          <Shimmer className="h-12 w-full rounded-xl" />
        </div>
      </div>
    </div>
  )
})
