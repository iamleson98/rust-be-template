'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Popular Routes Skeleton — 8 card grid ─── */
export const PopularRoutesSkeleton = memo(function PopularRoutesSkeleton({ count = 8 }: { count?: number }) {
  return (
    <section className="container mx-auto px-4 py-12 md:py-16">
      <div className="flex items-end justify-between mb-6">
        <div className="space-y-2">
          <Shimmer className="h-7 w-56" />
          <Shimmer className="h-4 w-40" />
        </div>
        <Shimmer className="h-9 w-32 rounded-lg" />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card key={i} className="overflow-hidden border-border/60">
            <Shimmer className="h-1.5 w-full rounded-none" />
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <Shimmer className="h-5 w-20 rounded-full" />
                <Shimmer className="h-3.5 w-10" />
              </div>
              <div className="flex items-center gap-2">
                <Shimmer className="h-8 w-8 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Shimmer className="h-4 w-20" />
                  <Shimmer className="h-2.5 w-12" />
                </div>
                <Shimmer className="h-8 w-8 rounded-full" />
                <div className="flex-1 space-y-1.5 text-right">
                  <Shimmer className="h-4 w-16 ml-auto" />
                  <Shimmer className="h-2.5 w-10 ml-auto" />
                </div>
              </div>
              <div className="flex items-center justify-between pt-2 border-t">
                <Shimmer className="h-3 w-12" />
                <Shimmer className="h-3 w-10" />
                <Shimmer className="h-3 w-20" />
              </div>
              <div className="flex items-center justify-between">
                <Shimmer className="h-4 w-28" />
                <Shimmer className="h-3 w-16" />
              </div>
              <Shimmer className="h-1.5 w-full rounded-full" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
})
