import { useNavigate } from '@tanstack/react-router'
import { Bus, CalendarClock, Gift, MessageSquareHeart } from 'lucide-react'
import type { LoyaltyResponse } from '@/api'
import { StatGrid, StatTile } from '@/components/console/stat-tile'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'

export type ConsoleStats = { upcoming: number; completed: number; awaitingFeedback: number }

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
  const navigate = useNavigate()
  const count = (n: number) => (loading ? '—' : formatNum(n))
  return (
    <StatGrid>
      <StatTile
        icon={<CalendarClock />}
        tone="sky"
        label={t('accountPage.console.activeTickets')}
        value={count(stats.upcoming)}
        hint={t(
          stats.upcoming > 0
            ? 'accountPage.console.activeTicketsSub'
            : 'accountPage.console.noActiveTickets',
        )}
        onClick={() => navigate({ to: '/account/trips' })}
      />
      <StatTile
        icon={<Bus />}
        tone="green"
        label={t('accountPage.console.completedTrips')}
        value={count(stats.completed)}
        hint={loyalty ? t('home.earnRateExplainerShort') : undefined}
        onClick={() => navigate({ to: '/account/trips' })}
      />
      <StatTile
        icon={<Gift />}
        tone="violet"
        label={t('nav.loyalty')}
        value={loyalty ? formatNum(loyalty.points) : '—'}
        hint={loyalty?.tier.name}
        onClick={() => navigate({ to: '/account/loyalty' })}
      />
      <StatTile
        icon={<MessageSquareHeart />}
        tone="amber"
        label={t('accountPage.console.awaitingFeedback')}
        value={count(stats.awaitingFeedback)}
        hint={t(
          stats.awaitingFeedback > 0
            ? 'accountPage.console.awaitingFeedbackSub'
            : 'accountPage.console.allCaughtUp',
        )}
        onClick={() => navigate({ to: '/account/feedback' })}
      />
    </StatGrid>
  )
}
