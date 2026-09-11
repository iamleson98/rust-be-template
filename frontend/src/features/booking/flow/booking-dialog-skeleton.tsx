'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Booking Dialog Skeleton — multi-step dialog placeholder ─── */
export const BookingDialogSkeleton = memo(function BookingDialogSkeleton() {
  return (
    <div className="max-w-3xl w-[95vw] max-h-[92vh] flex flex-col">
      {/* Header with stepper */}
      <div className="px-5 py-4 border-b bg-linear-to-r from-blue-50 to-blue-50 space-y-3">
        <div className="flex items-center gap-2">
          <Shimmer className="h-5 w-5 rounded" />
          <Shimmer className="h-5 w-44" />
        </div>
        <Shimmer className="h-3 w-56" />
        {/* Stepper row */}
        <div className="flex items-center gap-2 mt-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-1 flex-1">
              <Shimmer className="h-7 w-7 rounded-full" />
              <Shimmer className="h-3 w-16" />
              {i < 2 && <Shimmer className="h-px flex-1 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      {/* Trip summary bar */}
      <div className="px-5 py-2.5 bg-slate-50 border-b flex items-center gap-3">
        <Shimmer className="h-4 w-4 rounded" />
        <Shimmer className="h-3 w-32" />
        <Shimmer className="h-3 w-24" />
        <Shimmer className="h-3 w-20" />
        <div className="ml-auto flex gap-1">
          {Array.from({ length: 2 }).map((_, i) => (
            <Shimmer key={i} className="h-5 w-12 rounded" />
          ))}
        </div>
      </div>

      {/* Body — passenger form */}
      <div className="p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Shimmer className="h-4 w-48" />
            <Shimmer className="h-3 w-36" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-8 w-32 rounded-md" />
            <Shimmer className="h-8 w-32 rounded-md" />
          </div>
        </div>

        {/* Passenger rows */}
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center justify-between">
              <Shimmer className="h-5 w-28 rounded-full" />
              <Shimmer className="h-3 w-12" />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Shimmer className="h-10 w-full rounded-md" />
              <Shimmer className="h-10 w-full rounded-md" />
              <Shimmer className="h-10 w-full rounded-md" />
            </div>
            <Shimmer className="h-10 w-full rounded-md" />
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="border-t p-4 flex justify-between items-center">
        <div className="space-y-1.5">
          <Shimmer className="h-3 w-24" />
          <Shimmer className="h-6 w-32" />
        </div>
        <Shimmer className="h-10 w-40 rounded-lg" />
      </div>
    </div>
  )
})
