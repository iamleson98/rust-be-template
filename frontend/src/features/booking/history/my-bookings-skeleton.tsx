'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── My Bookings Skeleton — booking cards ─── */
export const MyBookingsSkeleton = memo(function MyBookingsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-5">
      {/* Stats cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="overflow-hidden">
            <Shimmer className="h-1 w-full rounded-none" />
            <CardContent className="p-4 md:p-5 flex items-center gap-3.5">
              <Shimmer className="h-11 w-11 rounded-xl" />
              <div className="space-y-1.5 flex-1">
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-6 w-24" />
                <Shimmer className="h-3 w-16" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Booking cards skeleton */}
      {Array.from({ length: count }).map((_, i) => (
        <Card key={i} className="overflow-hidden">
          <Shimmer className="h-1.5 w-full rounded-none" />
          <CardContent className="p-4 md:p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Shimmer className="h-6 w-28 rounded" />
                <Shimmer className="h-5 w-24 rounded-full" />
              </div>
              <Shimmer className="h-10 w-10 rounded-lg" />
            </div>
            <div className="flex items-center gap-3">
              <Shimmer className="h-8 w-8 rounded-lg" />
              <div className="space-y-1.5">
                <Shimmer className="h-4 w-40" />
                <Shimmer className="h-3 w-56" />
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Shimmer className="h-14 w-14 rounded-lg" />
              <div className="space-y-1.5">
                <Shimmer className="h-4 w-24" />
                <Shimmer className="h-3 w-20" />
                <Shimmer className="h-3 w-28" />
              </div>
              <div className="ml-auto space-y-1.5 text-right">
                <Shimmer className="h-7 w-28 ml-auto" />
                <Shimmer className="h-3 w-20 ml-auto" />
              </div>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
})
