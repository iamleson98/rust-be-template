import { useNavigate } from '@tanstack/react-router'
import { Bus, ChevronRight, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  STAGE_CONFIG,
  ticketStage,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { formatDay, formatVND } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { BusTile } from '@/components/bus-tile'
import { ConsoleCard, EmptyHint } from './console-card'

/** The five latest bookings with their price and (localised) status. */
export function RecentPurchasesCard({
  bookings,
  loading,
}: {
  bookings: BookingItem[]
  loading: boolean
}) {
  const t = useT()
  const navigate = useNavigate()

  return (
    <ConsoleCard
      bar="from-blue-500 to-blue-400"
      icon={<Ticket className="h-4 w-4 text-blue-600" />}
      title={t('accountPage.console.recentPurchases')}
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-lg" />
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <EmptyHint
          icon={<Bus className="size-5" aria-hidden />}
          tone="bg-blue-500/10 text-blue-600"
          text={t('accountPage.console.noPurchasesYet')}
          ctaLabel={t('home.bookATrip')}
          onCta={() => navigate({ to: '/' })}
        />
      ) : (
        <>
          <ul className="divide-y divide-border/60">
            {bookings.slice(0, 5).map((b) => (
              <li key={b.id} className="flex items-center gap-3 py-2.5">
                <BusTile accent={b.trip?.brandAccent} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {formatDay(b.trip?.departureAt ?? b.createdAt)} ·{' '}
                    <code className="font-mono">{b.code}</code>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-sm font-semibold tabular-nums">{formatVND(b.total)}</div>
                  <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {t(STAGE_CONFIG[ticketStage(b)].labelKey)}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <Button
            variant="ghost"
            size="sm"
            className="mt-2 w-full gap-1 text-blue-700 hover:bg-blue-50"
            onClick={() => navigate({ to: '/account/trips' })}
          >
            {t('accountPage.console.viewAllPurchases')}
            <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </>
      )}
    </ConsoleCard>
  )
}
