import { memo } from 'react'
import { cn } from '@/lib/utils'
import { Shimmer } from '@/components/ui/shimmer'
import { RAIL } from '../section'

/** Placeholder for the promo-code band. */
export const CampaignsSkeleton = memo(function CampaignsSkeleton({
  count = 3,
}: {
  count?: number
}) {
  return (
    <section className="page-x py-8 md:py-11" aria-hidden>
      <div className="mb-6 space-y-2">
        <Shimmer className="h-7 w-52" />
        <Shimmer className="h-4 w-64" />
      </div>
      <div className={cn(RAIL, 'lg:grid-cols-3')}>
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="flex h-28 overflow-hidden rounded-2xl ring-1 ring-slate-200/80">
            <Shimmer className="h-full w-24 rounded-none" />
            <div className="flex-1 space-y-3 p-4">
              <Shimmer className="h-4 w-32" />
              <Shimmer className="h-3 w-24" />
              <Shimmer className="h-7 w-28" />
            </div>
          </div>
        ))}
      </div>
    </section>
  )
})
