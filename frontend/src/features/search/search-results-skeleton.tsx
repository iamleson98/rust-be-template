'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'
import { TripCardDetailedSkeleton } from './trip-card-detailed-skeleton'

/* ───────────────────────────────────────────────────────────────────────
 P8-C: New skeletons — SearchResults, TripCardDetailed, BookingDialog,
 MapView — with premium shimmer + realistic content shapes.
 ─────────────────────────────────────────────────────────────────────── */

/* ─── Search Results Skeleton — full page with filter sidebar ─── */
export const SearchResultsSkeleton = memo(function SearchResultsSkeleton() {
  return (
    <div className="bg-slate-50 min-h-screen">
      <div className="container mx-auto px-4 py-6">
        {/* Top: search widget bar */}
        <div className="rounded-2xl bg-white p-4 mb-4 ring-1 ring-black/5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_1fr_auto] gap-3 items-end">
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="hidden md:block h-10 w-10 rounded-full" />
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="h-10 w-full rounded-lg" />
            <Shimmer className="h-10 w-24 rounded-lg" />
          </div>
          <div className="mt-4 flex justify-between items-center">
            <div className="flex gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Shimmer key={i} className="h-7 w-24 rounded-full" />
              ))}
            </div>
            <Shimmer className="h-10 w-36 rounded-lg" />
          </div>
        </div>

        {/* Header line */}
        <div className="flex items-center justify-between mb-4">
          <div className="space-y-2">
            <Shimmer className="h-7 w-56" />
            <Shimmer className="h-4 w-40" />
          </div>
          <div className="flex gap-2">
            <Shimmer className="h-9 w-20 rounded-lg" />
            <Shimmer className="h-9 w-28 rounded-lg" />
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-4">
          {/* Filter sidebar */}
          <aside className="hidden lg:block">
            <Card className="overflow-hidden sticky top-20">
              <Shimmer className="h-1 w-full rounded-none" />
              <div className="p-4 space-y-5">
                {/* Price */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  <Shimmer className="h-2 w-full rounded-full" />
                  <div className="flex justify-between">
                    <Shimmer className="h-3 w-12" />
                    <Shimmer className="h-3 w-12" />
                  </div>
                </div>
                {/* Time ranges */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-24" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                {/* Rating */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded-full" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                {/* Amenities */}
                <div className="space-y-2">
                  <Shimmer className="h-4 w-20" />
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <Shimmer className="h-4 w-4 rounded" />
                      <Shimmer className="h-3 flex-1" />
                      <Shimmer className="h-3 w-6" />
                    </div>
                  ))}
                </div>
                <Shimmer className="h-9 w-full rounded-lg" />
              </div>
            </Card>
          </aside>

          {/* Trip cards */}
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <TripCardDetailedSkeleton key={i} />
            ))}
          </div>
        </div>
      </div>
    </div>
  )
})
