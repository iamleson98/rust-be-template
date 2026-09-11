'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Trip Detail Skeleton — seat map + info ─── */
export const TripDetailSkeleton = memo(function TripDetailSkeleton() {
  return (
    <div className="max-w-5xl w-[95vw] max-h-[92vh]">
      {/* Header */}
      <div className="px-5 py-4 border-b bg-linear-to-r from-slate-50 to-white space-y-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-9 w-9 rounded-lg" />
          <div className="space-y-1.5">
            <Shimmer className="h-4 w-32" />
            <Shimmer className="h-3 w-48" />
          </div>
        </div>
        <Shimmer className="h-5 w-64" />
        <div className="flex items-center gap-2">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-3 w-16" />
        </div>
        <div className="flex items-center gap-2">
          <Shimmer className="h-5 w-20 rounded-full" />
          <Shimmer className="h-5 w-16 rounded-full" />
          <Shimmer className="h-5 w-20 rounded-full" />
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b bg-slate-50 px-3 py-2 flex gap-2">
        {Array.from({ length: 7 }).map((_, i) => (
          <Shimmer key={i} className="h-8 w-24 rounded-md" />
        ))}
      </div>

      {/* Body */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
        <div className="p-4 space-y-3 border-r">
          <div className="flex items-center justify-between">
            <Shimmer className="h-5 w-32" />
            <Shimmer className="h-4 w-28" />
          </div>
          {/* Seat grid */}
          <div className="grid grid-cols-5 gap-2">
            {Array.from({ length: 15 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-md" />
            ))}
          </div>
        </div>
        <div className="bg-slate-50 p-4 space-y-4">
          <div className="space-y-2">
            <Shimmer className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          <div className="space-y-2">
            <Shimmer className="h-3 w-20" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Shimmer key={i} className="h-12 w-full rounded-lg" />
            ))}
          </div>
          <Shimmer className="h-12 w-full rounded-lg" />
        </div>
      </div>
    </div>
  )
})
