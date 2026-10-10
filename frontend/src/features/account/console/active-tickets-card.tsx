import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CalendarClock, ChevronRight, Clock, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  effectiveDeparture,
  isBookingUpcoming,
  STAGE_CONFIG,
  ticketStage,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { formatDayTime } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { BusTile } from '@/components/bus-tile'
import { CountPill, EmptyState, Panel } from '@/components/console/panel'

type Translate = ReturnType<typeof useT>

function untilLabel(ms: number, t: Translate): string {
  const minutes = Math.floor(Math.max(0, ms - Date.now()) / 60_000)
  if (minutes < 1) return t('accountPage.console.departingNow')
  if (minutes < 60) return t('accountPage.console.inMinutes', { count: minutes })
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return t('accountPage.console.inHours', { hours, minutes: minutes % 60 })
  return t('accountPage.console.inDays', { count: Math.floor(hours / 24) })
}

/** Within the next day. (Kept out of the render body: `Date.now()` is impure.) */
const isUrgent = (departureMs: number) => departureMs - Date.now() < 24 * 3600_000

/** "Departs in …", re-rendered on its own every 30 s so nothing else on the page updates. */
function DepartureChip({ departureMs }: { departureMs: number }) {
  const t = useT()
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(id)
  }, [])
  const urgent = isUrgent(departureMs)
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold tabular-nums',
        urgent ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
      )}
    >
      <Clock className="size-3" aria-hidden />
      {untilLabel(departureMs, t)}
    </span>
  )
}

/** The next three upcoming trips, soonest first; the nearest carries a live countdown. */
export function ActiveTicketsCard({
  bookings,
  loading,
}: {
  bookings: BookingItem[]
  loading: boolean
}) {
  const t = useT()
  const navigate = useNavigate()
  const upcoming = useMemo(
    () =>
      bookings
        .filter(isBookingUpcoming)
        .sort((a, b) => effectiveDeparture(a) - effectiveDeparture(b))
        .slice(0, 3),
    [bookings],
  )

  return (
    <Panel
      icon={<CalendarClock />}
      title={t('accountPage.console.activeTickets')}
      action={upcoming.length > 0 && <CountPill n={upcoming.length} />}
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyState
          icon={<CalendarClock />}
          text={t('accountPage.console.noActiveTickets')}
          action={
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/' })}>
              {t('home.bookATrip')}
            </Button>
          }
        />
      ) : (
        <ul className="space-y-2">
          {upcoming.map((b, i) => {
            const departureMs = effectiveDeparture(b)
            const status = STAGE_CONFIG[ticketStage(b)]
            return (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => navigate({ to: '/account/trips/$code', params: { code: b.code } })}
                  className="group flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  <BusTile accent={b.trip?.brandAccent} size="md" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                        {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                      </span>
                      <ChevronRight
                        className="size-4 shrink-0 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3.5" aria-hidden />
                        {formatDayTime(b.trip?.departureAt ?? b.trip?.departureDate)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Ticket className="size-3.5" aria-hidden />
                        {b.seats?.length ?? 0} {t('accountPage.console.seatsUnit')}
                      </span>
                      <code className="font-mono">{b.code}</code>
                    </div>
                    <div className="mt-2">
                      {i === 0 && departureMs > 0 ? (
                        <DepartureChip departureMs={departureMs} />
                      ) : (
                        <span
                          className={cn(
                            'inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold',
                            status.cls,
                          )}
                        >
                          {t(status.labelKey)}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              </li>
            )
          })}
          <li>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full gap-1 text-primary hover:bg-primary/5"
              onClick={() => navigate({ to: '/account/trips' })}
            >
              {t('accountPage.console.viewAllTickets')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </li>
        </ul>
      )}
    </Panel>
  )
}
