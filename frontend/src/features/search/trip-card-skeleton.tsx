import { memo } from 'react'
import { Skeleton } from '@/components/ui/skeleton'

/** A trip card's shape while results load: operator, journey, fare. */
export const TripCardSkeleton = memo(function TripCardSkeleton() {
  return (
    <div
      className="grid gap-4 rounded-2xl bg-white p-4 ring-1 ring-slate-200/80 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-0 sm:p-0"
      aria-hidden
    >
      <div className="space-y-4 sm:p-5">
        <div className="flex items-center gap-2.5">
          <Skeleton className="size-9 rounded-xl" />
          <div className="space-y-1.5">
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Skeleton className="h-6 w-14" />
          <Skeleton className="h-0.5 flex-1" />
          <Skeleton className="h-6 w-14" />
        </div>
        <div className="flex gap-1.5">
          <Skeleton className="h-5 w-14 rounded-full" />
          <Skeleton className="h-5 w-16 rounded-full" />
        </div>
      </div>
      <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:w-48 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:border-l sm:p-5 md:w-52">
        <div className="space-y-1.5 sm:text-right">
          <Skeleton className="h-6 w-24 sm:ml-auto" />
          <Skeleton className="h-3 w-16 sm:ml-auto" />
        </div>
        <Skeleton className="h-10 w-28 rounded-xl sm:mt-3 sm:w-full" />
      </div>
    </div>
  )
})
