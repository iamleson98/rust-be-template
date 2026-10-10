import { useNavigate } from '@tanstack/react-router'
import { ArrowRight, History, MessageSquareHeart, Star } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { BookingItem } from '@/features/booking/history/booking-types'
import { formatDay } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { BusTile } from '@/components/bus-tile'
import { CountPill, Panel } from '@/components/console/panel'

/** Finished trips still waiting for a review (hidden when there are none). */
export function AwaitingFeedbackCard({ bookings }: { bookings: BookingItem[] }) {
  const t = useT()
  const navigate = useNavigate()
  if (bookings.length === 0) return null

  return (
    <Panel
      icon={<MessageSquareHeart />}
      title={t('accountPage.console.rateYourTrips')}
      action={<CountPill n={bookings.length} tone="amber" />}
    >
      <p className="mb-3 text-xs text-muted-foreground">
        {t('accountPage.console.rateYourTripsDesc')}
      </p>
      <ul className="space-y-2">
        {bookings.slice(0, 3).map((b) => (
          <li key={b.id} className="flex items-center gap-3 rounded-lg border p-3">
            <BusTile accent={b.trip?.brandAccent} size="md" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">
                {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
              </div>
              <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <History className="size-3" aria-hidden />
                  {formatDay(b.trip?.departureAt ?? b.createdAt)}
                </span>
                {b.trip?.brandName && <span className="truncate">{b.trip.brandName}</span>}
              </div>
            </div>
            <div className="hidden items-center gap-0.5 sm:flex" aria-hidden>
              {Array.from({ length: 5 }, (_, i) => (
                <Star key={i} className="size-3.5 text-amber-300" />
              ))}
            </div>
          </li>
        ))}
      </ul>
      <Button className="mt-3 w-full gap-1.5" onClick={() => navigate({ to: '/account/feedback' })}>
        <MessageSquareHeart className="h-4 w-4" />
        {t('accountPage.console.giveFeedbackCta')}
        <ArrowRight className="h-4 w-4" />
      </Button>
    </Panel>
  )
}
