'use client'

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Shimmer } from '@/components/ui/shimmer'

/* ─── Testimonials Skeleton — testimonial cards ─── */
export const TestimonialsSkeleton = memo(function TestimonialsSkeleton({ count = 3 }: { count?: number }) {
  return (
    <section className="relative container mx-auto px-4 py-16">
      <div className="text-center max-w-2xl mx-auto mb-10">
        <Shimmer className="h-6 w-44 rounded-full mx-auto mb-3" />
        <Shimmer className="h-9 w-72 mx-auto mb-3" />
        <Shimmer className="h-4 w-48 mx-auto" />
      </div>

      <div className="mb-10 max-w-2xl mx-auto">
        <Card className="border-blue-100 bg-linear-to-br from-blue-50/80 to-blue-50/50">
          <CardContent className="p-5">
            <div className="flex flex-col sm:flex-row items-center gap-5">
              <div className="flex flex-col items-center shrink-0 space-y-2">
                <Shimmer className="h-12 w-16" />
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Shimmer key={i} className="h-4 w-4 rounded" />
                  ))}
                </div>
                <Shimmer className="h-3 w-14" />
              </div>
              <div className="flex-1 w-full space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Shimmer className="h-3 w-4" />
                    <Shimmer className="h-4 w-4 rounded" />
                    <Shimmer className="h-2.5 flex-1 rounded-full" />
                    <Shimmer className="h-3 w-8" />
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-5 overflow-x-auto pb-2">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="snap-start shrink-0 w-75 sm:w-85">
            <Card className="border-slate-100">
              <CardContent className="p-5 space-y-3">
                <div className="flex items-center gap-3">
                  <Shimmer className="h-10 w-10 rounded-full" />
                  <div className="flex-1 space-y-1.5">
                    <Shimmer className="h-4 w-24" />
                    <Shimmer className="h-3 w-20" />
                  </div>
                  <Shimmer className="h-3 w-12" />
                </div>
                <div className="flex gap-0.5">
                  {Array.from({ length: 5 }).map((_, j) => (
                    <Shimmer key={j} className="h-4 w-4 rounded" />
                  ))}
                </div>
                <Shimmer className="h-3 w-full" />
                <Shimmer className="h-3 w-5/6" />
                <Shimmer className="h-3 w-2/3" />
              </CardContent>
            </Card>
          </div>
        ))}
      </div>
    </section>
  )
})
