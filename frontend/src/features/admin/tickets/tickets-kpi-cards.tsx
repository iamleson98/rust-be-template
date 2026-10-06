'use client'

import { Ticket as TicketIcon, DollarSign, CheckCircle2, TrendingUp, Ban } from 'lucide-react'
import type { AdminBookingTotals } from '@/lib/api/types.gen'
import { KpiCard } from '@/features/admin/dashboard/kpi-card'
import { useT } from '@/lib/i18n'
import { formatVND } from './tickets-helpers'

/**
 * KPI cards row — totals come from the dedicated /stats endpoint
 * (`AdminBookingStatsResponse.totals`), not from the list response.
 */
export function TicketsKpiCards({ totals }: { totals: AdminBookingTotals | undefined }) {
  const t = useT()
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        icon={<TicketIcon className="h-5 w-5" />}
        label={t('adminTickets.kpiTotal')}
        value={totals ? String(totals.total) : '—'}
        change=""
        up
        color="#2563eb"
      />
      <KpiCard
        icon={<DollarSign className="h-5 w-5" />}
        label={t('adminTickets.kpiRevenue')}
        value={totals ? formatVND(totals.revenue) : '—'}
        change=""
        up
        color="#16a34a"
      />
      <KpiCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label={t('adminTickets.statusConfirmed')}
        value={totals ? String(totals.confirmed) : '—'}
        change=""
        up
        color="#0ea5e9"
      />
      <KpiCard
        icon={<TrendingUp className="h-5 w-5" />}
        label={t('adminTickets.statusCompleted')}
        value={totals ? String(totals.completed) : '—'}
        change=""
        up
        color="#10b981"
      />
      <KpiCard
        icon={<Ban className="h-5 w-5" />}
        label={t('adminTickets.statusCancelled')}
        value={totals ? String(totals.cancelled) : '—'}
        change=""
        color="#f43f5e"
      />
    </div>
  )
}
