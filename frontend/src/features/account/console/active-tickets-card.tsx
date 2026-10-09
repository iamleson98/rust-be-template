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
import { ConsoleCard, CountBadge, EmptyHint } from './console-card'

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
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-bold tabular-nums',
        urgent ? 'bg-blue-600 text-white' : 'bg-blue-500/10 text-blue-700 ring-1 ring-blue-500/20',
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
    <ConsoleCard
      bar="from-sky-500 to-blue-600"
      icon={<CalendarClock className="h-4 w-4 text-blue-600" />}
      title={t('accountPage.console.activeTickets')}
      badge={upcoming.length > 0 && <CountBadge n={upcoming.length} />}
    >
      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      ) : upcoming.length === 0 ? (
        <EmptyHint
          icon={<CalendarClock className="size-5" aria-hidden />}
          tone="bg-sky-500/10 text-sky-600"
          text={t('accountPage.console.noActiveTickets')}
          ctaLabel={t('home.bookATrip')}
          onCta={() => navigate({ to: '/' })}
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
                  className="group flex w-full items-center gap-3 rounded-xl border bg-slate-50/60 p-3 text-left transition-all hover:border-blue-300 hover:bg-blue-50/40"
                >
                  <BusTile accent={b.trip?.brandAccent} size="lg" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">
                      {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <CalendarClock className="size-3" aria-hidden />
                        {formatDayTime(b.trip?.departureAt ?? b.trip?.departureDate)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Ticket className="size-3" aria-hidden />
                        {b.seats?.length ?? 0} {t('accountPage.console.seatsUnit')}
                        <code className="font-mono">{b.code}</code>
                      </span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {i === 0 && departureMs > 0 ? (
                      <DepartureChip departureMs={departureMs} />
                    ) : (
                      <span
                        className={cn(
                          'inline-flex items-center rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide',
                          status.cls,
                        )}
                      >
                        {t(status.labelKey)}
                      </span>
                    )}
                    <span className="hidden items-center gap-0.5 text-[11px] font-medium text-blue-700 group-hover:flex sm:inline-flex">
                      {t('accountPage.console.manageTicket')}
                      <ChevronRight
                        className="size-3 transition-transform group-hover:translate-x-0.5"
                        aria-hidden
                      />
                    </span>
                  </div>
                </button>
              </li>
            )
          })}
          <li>
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 w-full gap-1 text-blue-700 hover:bg-blue-50"
              onClick={() => navigate({ to: '/account/trips' })}
            >
              {t('accountPage.console.viewAllTickets')}
              <ChevronRight className="h-3.5 w-3.5" />
            </Button>
          </li>
        </ul>
      )}
    </ConsoleCard>
  )
}
