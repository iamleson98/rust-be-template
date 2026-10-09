import type { ReactNode } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bus, CalendarClock, ChevronRight, Gift, MessageSquareHeart } from 'lucide-react'
import type { LoyaltyResponse } from '@/api'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

export type ConsoleStats = { upcoming: number; completed: number; awaitingFeedback: number }

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
  to,
}: {
  icon: ReactNode
  label: string
  value: string
  sub?: string
  /** Icon tile background. */
  accent: string
  to: '/account/trips' | '/account/loyalty' | '/account/feedback'
}) {
  const navigate = useNavigate()
  return (
    <button
      type="button"
      onClick={() => navigate({ to })}
      className="group flex cursor-pointer items-center gap-3 rounded-xl border bg-white p-4 text-left transition-all hover:border-blue-300 dark:bg-card"
    >
      <div className={cn('flex size-10 shrink-0 items-center justify-center rounded-lg', accent)}>
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{label}</div>
        <div className="text-xl font-bold leading-tight tabular-nums">{value}</div>
        {sub && <div className="mt-0.5 truncate text-[11px] text-muted-foreground">{sub}</div>}
      </div>
      <ChevronRight
        className="ml-auto size-4 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5"
        aria-hidden
      />
    </button>
  )
}

/** The four headline numbers; every one is derived from real bookings / loyalty data. */
export function ConsoleStatCards({
  stats,
  loading,
  loyalty,
}: {
  stats: ConsoleStats
  loading: boolean
  loyalty?: LoyaltyResponse
}) {
  const t = useT()
  const count = (n: number) => (loading ? '—' : String(n))
  return (
    <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
      <StatCard
        icon={<CalendarClock className="h-5 w-5 text-sky-600" />}
        label={t('accountPage.console.activeTickets')}
        value={count(stats.upcoming)}
        sub={t(stats.upcoming > 0 ? 'accountPage.console.activeTicketsSub' : 'accountPage.console.noActiveTickets')}
        accent="bg-sky-500/10"
        to="/account/trips"
      />
      <StatCard
        icon={<Bus className="h-5 w-5 text-emerald-600" />}
        label={t('accountPage.console.completedTrips')}
        value={count(stats.completed)}
        sub={loyalty ? t('home.earnRateExplainerShort') : undefined}
        accent="bg-emerald-500/10"
        to="/account/trips"
      />
      <StatCard
        icon={<Gift className="h-5 w-5 text-violet-600" />}
        label={t('nav.loyalty')}
        value={loyalty ? formatNum(loyalty.points) : '—'}
        sub={loyalty?.tier.name}
        accent="bg-violet-500/10"
        to="/account/loyalty"
      />
      <StatCard
        icon={<MessageSquareHeart className="h-5 w-5 text-amber-600" />}
        label={t('accountPage.console.awaitingFeedback')}
        value={count(stats.awaitingFeedback)}
        sub={t(
          stats.awaitingFeedback > 0
            ? 'accountPage.console.awaitingFeedbackSub'
            : 'accountPage.console.allCaughtUp',
        )}
        accent="bg-amber-500/10"
        to="/account/feedback"
      />
    </div>
  )
}
