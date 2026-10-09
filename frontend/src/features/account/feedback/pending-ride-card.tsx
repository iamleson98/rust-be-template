import { lazy, Suspense } from 'react'
import { CalendarDays, MessageSquareHeart, Star } from 'lucide-react'
import { BusTile } from '@/components/bus-tile'
import { Card } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import type { BookingItem } from '@/features/booking/history/booking-types'
import { formatDay, formatVND } from '@/lib/format'
import { useT } from '@/lib/i18n'

export const FeedbackForm = lazy(() =>
  import('./feedback-form').then((m) => ({ default: m.FeedbackForm })),
)
export const FormFallback = <div className="h-32 animate-pulse rounded-lg bg-slate-100" />

/** A finished trip without a review: click to rate it in place. */
export function PendingRideCard({
  booking,
  expanded,
  onToggle,
  onSubmitted,
}: {
  booking: BookingItem
  expanded: boolean
  onToggle: () => void
  onSubmitted: () => void
}) {
  const t = useT()
  const trip = booking.trip
  return (
    <Card className="group overflow-hidden ring-1 ring-black/5">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center gap-4 px-4 py-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-expanded={expanded}
      >
        <BusTile accent={trip?.brandAccent} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">
            {trip?.routeName || t('accountPage.feedback.tripFallback')}
          </div>
          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1 truncate">
              <CalendarDays className="size-3" />
              {formatDay(trip?.departureAt || booking.createdAt)}
            </span>
            {trip?.brandName && <span className="truncate">{trip.brandName}</span>}
            <span className="inline-flex shrink-0 items-center gap-1">
              <Star className="size-3 text-amber-500" />
              {t('accountPage.feedback.seatsCount', { count: booking.seats.length })}
            </span>
          </div>
        </div>
        <div className="hidden text-sm font-semibold tabular-nums sm:block">
          {formatVND(booking.total)}
        </div>
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1.5 text-xs font-semibold text-amber-600 ring-1 ring-amber-500/20 transition-colors group-hover:bg-amber-500/15">
          <MessageSquareHeart className="size-3.5" />
          {t('accountPage.feedback.rateNow')}
        </span>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-4 py-4">
          <Suspense fallback={FormFallback}>
            <FeedbackForm
              booking={booking}
              existingReview={null}
              onSubmitted={onSubmitted}
              onClose={onToggle}
            />
          </Suspense>
        </div>
      )}
    </Card>
  )
}

export function PendingRideSkeleton() {
  return (
    <Card className="overflow-hidden ring-1 ring-black/5" aria-hidden>
      <div className="flex items-center gap-4 px-4 py-3.5">
        <Skeleton className="size-11 rounded-xl" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-44" />
          <Skeleton className="h-3 w-56" />
        </div>
        <Skeleton className="h-7 w-24 rounded-full" />
      </div>
    </Card>
  )
}
