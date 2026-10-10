import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ui/shimmer'
import { RAIL } from '../section'

/** Placeholder for the popular-routes band: heading and route cards. */
export const PopularRoutesSkeleton = memo(function PopularRoutesSkeleton({
  count = 4,
}: {
  count?: number
}) {
  return (
    <section className="page-x py-8 md:py-11" aria-hidden>
      <div className="mb-6 space-y-2">
        <Shimmer className="h-7 w-56" />
        <Shimmer className="h-4 w-40" />
      </div>
      <div className={cn(RAIL, 'lg:grid-cols-4')}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80">
            <Shimmer className="h-3.5 w-28" />
            <div className="space-y-3">
              <Shimmer className="h-4 w-3/4" />
              <Shimmer className="h-4 w-2/3" />
            </div>
            <div className="flex justify-between border-t border-slate-100 pt-3">
              <Shimmer className="h-3.5 w-20" />
              <Shimmer className="h-5 w-24" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
})
