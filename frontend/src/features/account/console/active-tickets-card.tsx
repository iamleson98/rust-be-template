import { useEffect, useMemo, useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Bus, CalendarClock, ChevronRight, Clock, Ticket } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  effectiveDeparture,
  isBookingUpcoming,
  STAGE_CONFIG,
  ticketStage,
  type BookingItem,
} from '@/features/booking/history/booking-types'
import { formatDateVN, formatDayTime, formatTimeVN } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { BusTile } from '@/components/bus-tile'

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

/**
 * The next trip as a boarding pass (live countdown, times, seats, code), the
 * two after it as rows, or a nudge to book when there is none.
 */
export function ActiveTicketsCard({
  bookings,
  loading,
}: {
  bookings: BookingItem[]
  loading: boolean
}) {
  const t = useT()
  const upcoming = useMemo(
    () =>
      bookings
        .filter(isBookingUpcoming)
        .sort((a, b) => effectiveDeparture(a) - effectiveDeparture(b))
        .slice(0, 3),
    [bookings],
  )
  const [next, ...later] = upcoming

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">
          {t('accountPage.console.activeTickets')}
        </h2>
        {upcoming.length > 0 && (
          <Link
            to="/account/trips"
            className="inline-flex items-center gap-0.5 text-sm font-semibold text-primary hover:underline"
          >
            {t('accountPage.console.viewAllTickets')}
            <ChevronRight className="size-4" />
          </Link>
        )}
      </div>

      {loading ? (
        <Skeleton className="h-44 w-full rounded-2xl" />
      ) : !next ? (
        <div className="flex flex-col items-center rounded-2xl bg-white px-6 py-10 text-center shadow-soft ring-1 ring-slate-200/80">
          <span className="grid size-12 place-items-center rounded-full bg-primary/10 text-primary">
            <CalendarClock className="size-6" />
          </span>
          <p className="mt-3 text-sm text-slate-500">{t('accountPage.console.noActiveTickets')}</p>
          <Button asChild className="mt-4 rounded-xl">
            <Link to="/search">{t('home.bookATrip')}</Link>
          </Button>
        </div>
      ) : (
        <>
          <NextTrip booking={next} />
          {later.map((b) => (
            <Link
              key={b.id}
              to="/account/trips/$code"
              params={{ code: b.code }}
              className="group flex items-center gap-3 rounded-2xl bg-white p-3.5 shadow-soft ring-1 ring-slate-200/80 transition-colors hover:ring-primary/30"
            >
              <BusTile accent={b.trip?.brandAccent} size="md" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold text-slate-900">
                  {b.trip?.routeName ?? t('accountPage.feedback.tripFallback')}
                </div>
                <div className="text-xs text-slate-500">
                  {formatDayTime(b.trip?.departureAt ?? b.trip?.departureDate)} · {b.code}
                </div>
              </div>
              <ChevronRight className="size-4 shrink-0 text-slate-300 group-hover:text-primary" />
            </Link>
          ))}
        </>
      )}
    </section>
  )
}

/** The nearest trip, laid out like a boarding pass. */
function NextTrip({ booking: b }: { booking: BookingItem }) {
  const t = useT()
  const departureMs = effectiveDeparture(b)
  const status = STAGE_CONFIG[ticketStage(b)]
  return (
    <Link
      to="/account/trips/$code"
      params={{ code: b.code }}
      className="group block overflow-hidden rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80 transition hover:shadow-float hover:ring-primary/30"
    >
      <div className="flex items-center justify-between gap-2 px-5 pt-4">
        {departureMs > 0 && <DepartureChip departureMs={departureMs} />}
        <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', status.cls)}>
          {t(status.labelKey)}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 px-5 py-4">
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
            {b.trip?.departureTime ?? formatTimeVN(b.trip?.departureAt)}
          </div>
          <div className="truncate text-sm text-slate-500">
            {b.trip?.fromName ?? b.trip?.routeName}
          </div>
        </div>
        <span className="grid size-9 place-items-center rounded-full bg-primary/10 text-primary">
          <Bus className="size-4.5" />
        </span>
        <div className="min-w-0 text-right">
          <div className="text-sm font-semibold text-slate-900">
            {formatDateVN(b.trip?.departureAt ?? b.trip?.departureDate, {
              weekday: 'short',
              day: '2-digit',
              month: '2-digit',
            })}
          </div>
          <div className="truncate text-sm text-slate-500">{b.trip?.toName ?? ''}</div>
        </div>
      </div>
      <div className="relative border-t border-dashed border-slate-200" aria-hidden>
        <span className="absolute -top-2 -left-2 size-4 rounded-full bg-canvas ring-1 ring-slate-200" />
        <span className="absolute -top-2 -right-2 size-4 rounded-full bg-canvas ring-1 ring-slate-200" />
      </div>
      <div className="flex items-center gap-4 px-5 py-3 text-xs text-slate-500">
        <span className="truncate">{b.trip?.brandName}</span>
        <span className="inline-flex shrink-0 items-center gap-1">
          <Ticket className="size-3.5" />
          {b.seats
            .map((s) => s.seatCode)
            .filter(Boolean)
            .join(', ')}
        </span>
        <code className="ml-auto shrink-0 font-mono font-semibold text-slate-700">{b.code}</code>
      </div>
    </Link>
  )
}
