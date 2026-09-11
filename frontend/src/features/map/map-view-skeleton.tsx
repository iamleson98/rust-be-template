'use client'

import { memo } from 'react'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Map View Skeleton — for route map / live tracking ─── */
export const MapViewSkeleton = memo(function MapViewSkeleton() {
  return (
    <div className="relative w-full h-[400px] rounded-xl overflow-hidden border bg-slate-100">
      {/* Map background — gradient resembling a map */}
      <div className="absolute inset-0 bg-linear-to-br from-blue-50 via-blue-50 to-amber-50" />
      {/* Fake roads grid */}
      <svg className="absolute inset-0 w-full h-full opacity-20" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="60" height="60" patternUnits="userSpaceOnUse">
            <path d="M 60 0 L 0 0 0 60" fill="none" stroke="oklch(0.4 0.05 250)" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
      </svg>

      {/* Center route placeholder */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="w-3/4 h-32 space-y-2">
          <Shimmer className="h-2 w-full rounded-full" />
          <div className="flex justify-between items-center mt-4">
            <div className="flex flex-col items-center gap-2">
              <Shimmer className="h-10 w-10 rounded-full" />
              <Shimmer className="h-3 w-20" />
            </div>
            <Shimmer className="h-1 flex-1 mx-3 rounded-full" />
            <div className="flex flex-col items-center gap-2">
              <Shimmer className="h-10 w-10 rounded-full" />
              <Shimmer className="h-3 w-20" />
            </div>
          </div>
        </div>
      </div>

      {/* Top overlay bar */}
      <div className="absolute top-3 left-3 right-3 flex items-center gap-2 bg-white/80 backdrop-blur rounded-lg p-2">
        <Shimmer className="h-4 w-4 rounded" />
        <Shimmer className="h-4 w-32" />
        <Shimmer className="ml-auto h-4 w-20" />
      </div>

      {/* Bottom sheet placeholder */}
      <div className="absolute bottom-3 left-3 right-3 bg-white/80 backdrop-blur rounded-lg p-3 flex items-center gap-3">
        <Shimmer className="h-10 w-10 rounded-lg" />
        <div className="flex-1 space-y-1.5">
          <Shimmer className="h-3 w-32" />
          <Shimmer className="h-3 w-24" />
        </div>
        <Shimmer className="h-8 w-20 rounded-md" />
      </div>
    </div>
  )
})
