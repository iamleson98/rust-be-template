'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Detailed Trip Card Skeleton — all sections ─── */
export const TripCardDetailedSkeleton = memo(function TripCardDetailedSkeleton() {
  return (
    <Card className="overflow-hidden border-border/60">
      <Shimmer className="absolute left-0 top-0 bottom-0 w-1 rounded-none" />
      <div className="flex flex-col md:flex-row">
        {/* Brand block */}
        <div className="md:w-44 shrink-0 bg-linear-to-b from-slate-50 to-slate-100/50 p-3 md:p-4 md:border-r flex flex-row md:flex-col items-center md:items-start gap-3 relative">
          <div className="absolute inset-0 bg-linear-to-br from-white/50 to-transparent pointer-events-none" />
          <Shimmer className="h-12 w-12 rounded-xl shrink-0" />
          <div className="min-w-0 flex-1 space-y-2">
            <Shimmer className="h-4 w-24" />
            <div className="flex items-center gap-1">
              <Shimmer className="h-3 w-3 rounded" />
              <Shimmer className="h-3 w-12" />
            </div>
            <Shimmer className="h-5 w-20 rounded-full" />
          </div>
        </div>

        {/* Time + amenities */}
        <div className="flex-1 p-3 md:p-4 min-w-0">
          <div className="flex items-center gap-3">
            <div className="space-y-1.5">
              <Shimmer className="h-7 w-14" />
              <Shimmer className="h-3 w-16" />
            </div>
            <div className="flex-1 min-w-[60px]">
              <Shimmer className="h-1 w-full rounded-full" />
              <div className="mt-1 flex justify-center">
                <Shimmer className="h-3 w-20 rounded-full" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Shimmer className="h-7 w-14" />
              <Shimmer className="h-3 w-16" />
            </div>
          </div>
          {/* Amenities row */}
          <div className="mt-3 flex items-center gap-1.5">
            {Array.from({ length: 4 }).map((_, i) => (
              <Shimmer key={i} className="h-6 w-16 rounded-md" />
            ))}
            <Shimmer className="ml-auto h-3 w-24" />
          </div>
          {/* Availability bar */}
          <div className="mt-3">
            <Shimmer className="h-1.5 w-full rounded-full" />
          </div>
        </div>

        {/* Price + CTA */}
        <div className="shrink-0 p-3 md:p-4 border-t md:border-t-0 md:border-l bg-linear-to-br from-blue-50/80 to-blue-50/80 md:w-52 space-y-2 md:text-right">
          <Shimmer className="h-3 w-8 ml-auto" />
          <Shimmer className="h-3 w-16 ml-auto" />
          <Shimmer className="h-8 w-28 ml-auto" />
          <Shimmer className="h-9 w-full rounded-lg mt-2" />
          <Shimmer className="h-3 w-20 ml-auto" />
        </div>
      </div>
    </Card>
  )
})
