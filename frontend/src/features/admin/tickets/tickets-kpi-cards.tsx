'use client'

import { Ban, CheckCircle2, DollarSign, Flag, Ticket as TicketIcon } from 'lucide-react'
import type { AdminBookingTotals } from '@/api'
import { StatGrid, StatTile } from '@/components/console/stat-tile'
import { formatNum } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { formatVND } from './tickets-helpers'

/**
 * The tickets the filters select, by status, and what they brought in —
 * totals from the dedicated /stats endpoint, not the paged list.
 */
export function TicketsKpiCards({ totals }: { totals: AdminBookingTotals | undefined }) {
  const t = useT()
  const n = (v: number | undefined) => (totals ? formatNum(v ?? 0) : '—')
  return (
    <StatGrid className="sm:grid-cols-3 lg:grid-cols-5">
      <StatTile
        icon={<TicketIcon />}
        tone="blue"
        label={t('adminTickets.kpiTotal')}
        value={n(totals?.total)}
      />
      <StatTile
        icon={<DollarSign />}
        tone="green"
        label={t('adminTickets.kpiRevenue')}
        value={totals ? formatVND(totals.revenue) : '—'}
      />
      <StatTile
        icon={<CheckCircle2 />}
        tone="sky"
        label={t('adminTickets.statusConfirmed')}
        value={n(totals?.confirmed)}
      />
      <StatTile
        icon={<Flag />}
        tone="violet"
        label={t('adminTickets.statusCompleted')}
        value={n(totals?.completed)}
      />
      <StatTile
        icon={<Ban />}
        tone="rose"
        label={t('adminTickets.statusCancelled')}
        value={n(totals?.cancelled)}
      />
    </StatGrid>
  )
}
