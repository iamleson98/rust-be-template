'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Campaigns Skeleton — campaign cards ─── */
export const CampaignsSkeleton = memo(function CampaignsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="bg-linear-to-br from-amber-50 via-orange-50 to-rose-50 border-y border-amber-100/80">
      <div className="container mx-auto px-4 py-12">
        <div className="flex items-end justify-between mb-6">
          <div className="space-y-2">
            <Shimmer className="h-7 w-52" />
            <Shimmer className="h-4 w-64" />
          </div>
          <div className="hidden sm:flex items-center gap-1.5">
            {Array.from({ length: count }).map((_, i) => (
              <Shimmer key={i} className="h-1.5 w-4 rounded-full" />
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: count }).map((_, i) => (
            <Card key={i} className="relative overflow-hidden border-0 h-full">
              <Shimmer className="absolute left-0 top-0 bottom-0 w-1.5 rounded-none" />
              <div className="p-5 pl-6 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-2 flex-1">
                    <Shimmer className="h-5 w-28 rounded-full" />
                    <Shimmer className="h-5 w-40" />
                    <Shimmer className="h-3 w-24" />
                  </div>
                  <Shimmer className="h-6 w-20 rounded" />
                </div>
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-3/4" />
                <div className="flex items-center justify-between pt-1">
                  <Shimmer className="h-8 w-24 rounded-md" />
                  <Shimmer className="h-8 w-20 rounded-lg" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
})
