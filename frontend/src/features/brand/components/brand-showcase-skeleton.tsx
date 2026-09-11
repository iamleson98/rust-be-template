'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Brand Showcase Skeleton — horizontal scroll ─── */
export const BrandShowcaseSkeleton = memo(function BrandShowcaseSkeleton({ count = 5 }: { count?: number }) {
  return (
    <section className="container mx-auto px-4 py-12 md:py-16">
      <div className="flex items-end justify-between mb-8">
        <div className="space-y-2">
          <Shimmer className="h-7 w-64" />
          <Shimmer className="h-4 w-48" />
        </div>
        <Shimmer className="h-8 w-24" />
      </div>

      <div className="flex gap-4 overflow-x-auto pb-4">
        {Array.from({ length: count }).map((_, i) => (
          <Card
            key={i}
            className="snap-start shrink-0 w-65 sm:w-70 overflow-hidden border-border/60"
          >
            <Shimmer className="h-1.5 w-full rounded-none" />
            <div className="p-4 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <Shimmer className="h-11 w-11 rounded-lg" />
                <div className="flex-1 space-y-1.5">
                  <Shimmer className="h-4 w-24" />
                  <Shimmer className="h-3 w-20" />
                </div>
              </div>
              <Shimmer className="h-5 w-20 rounded-full" />
              <Shimmer className="h-9 w-full rounded-lg" />
            </div>
          </Card>
        ))}
      </div>
    </section>
  )
})
