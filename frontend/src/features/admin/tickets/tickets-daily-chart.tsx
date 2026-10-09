import { useMemo } from 'react'
import { TrendingUp } from 'lucide-react'
import type { AdminBookingDayBucket } from '@/api'
import { Panel } from '@/components/console/panel'
import { dayBars, periodDays } from '@/features/admin/dashboard/helpers'
import { useT } from '@/lib/i18n'
import { formatVND } from './tickets-helpers'

/** More days than this are summed into wider bars, so each stays tappable on a phone. */
const MAX_BARS = 31

const dayMonth = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`

/**
 * Tickets per day over the selected period. The server only reports days
 * that had bookings, so every other day of the period is drawn as zero.
 * Without a fixed period (a custom range left open) the chart spans the
 * first to the last reported day.
 */
export function TicketsDailyChart({
  byDay,
  dateFrom,
  dateTo,
}: {
  byDay: AdminBookingDayBucket[]
  dateFrom?: string
  dateTo?: string
}) {
  const t = useT()
  const bars = useMemo(() => {
    const reported = byDay.map((d) => d.date).sort()
    const from = dateFrom ?? reported[0]
    const to = dateTo ?? reported.at(-1)
    if (!from || !to || from > to) return []
    const days = periodDays({ dateFrom: from, dateTo: to })
    const counts = dayBars(days, new Map(byDay.map((d) => [d.date, d.count])), MAX_BARS, dayMonth)
    const revenue = dayBars(
      days,
      new Map(byDay.map((d) => [d.date, d.revenue])),
      MAX_BARS,
      dayMonth,
    )
    return counts.map((bar, i) => ({ ...bar, revenue: revenue[i].value }))
  }, [byDay, dateFrom, dateTo])

  const max = Math.max(1, ...bars.map((b) => b.value))

  return (
    <Panel title={t('adminTickets.dailyStatsTitle')} icon={<TrendingUp />}>
      <p className="mb-2 text-xs text-muted-foreground">{t('adminTickets.ticketsPerDay')}</p>
      {bars.length === 0 ? (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {t('adminTickets.noDailyStats')}
        </p>
      ) : (
        <>
          <div className="flex h-32 items-end gap-px sm:gap-0.5">
            {bars.map((bar) => (
              <div
                key={bar.date}
                title={t('adminTickets.dayTooltip', {
                  date: bar.label,
                  count: bar.value,
                  revenue: formatVND(bar.revenue),
                })}
                className="min-w-0 flex-1 rounded-t-sm bg-primary/60 transition-colors hover:bg-primary"
                style={{ height: `${Math.max(2, (bar.value / max) * 100)}%` }}
              />
            ))}
          </div>
          <div className="mt-1.5 flex justify-between text-[11px] text-muted-foreground tabular-nums">
            <span>{bars[0].label}</span>
            <span>{bars.at(-1)!.label}</span>
          </div>
        </>
      )}
    </Panel>
  )
}
