'use client'

import { memo } from 'react'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'

/* Skeleton loader for trip cards — shadcn Skeleton primitives
 * (bg-accent + animate-pulse, see components/ui/skeleton.tsx) laid out
 * to mirror the real card: brand column, route + amenities, price CTA.
 * The animated pulse is what makes it read as "loading" instead of an
 * empty/broken card. */
export const TripCardSkeleton = memo(function TripCardSkeleton() {
  return (
    <Card className="overflow-hidden border-border/60" aria-busy="true">
      <div className="flex flex-col md:flex-row">
        <div className="md:w-40 shrink-0 bg-muted/40 p-3.5 md:border-r border-border/50">
          <div className="flex flex-row md:flex-col items-center gap-3">
            <Skeleton className="h-11 w-11 rounded-lg shrink-0" />
            <div className="space-y-2 flex-1">
              <Skeleton className="h-4 w-20" />
              <Skeleton className="h-3 w-12" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4">
          <div className="flex items-center gap-3">
            <div className="space-y-2">
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-3 w-16" />
            </div>
            <Skeleton className="flex-1 h-0.5" />
            <div className="space-y-2">
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-3 w-16" />
            </div>
          </div>
          <div className="mt-3 flex gap-1.5">
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-md" />
            <Skeleton className="h-6 w-6 rounded-md" />
          </div>
        </div>
        <div className="md:w-56 shrink-0 p-4 border-t md:border-t-0 md:border-l border-border/50 bg-muted/40">
          <div className="space-y-2 md:text-right">
            <Skeleton className="h-3 w-8" />
            <Skeleton className="h-7 w-24 md:ml-auto" />
            <Skeleton className="h-8 rounded-lg w-full mt-2" />
          </div>
        </div>
      </div>
    </Card>
  )
})
