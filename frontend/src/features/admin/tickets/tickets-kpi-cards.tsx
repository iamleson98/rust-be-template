'use client'

import {
  Ticket as TicketIcon,
  DollarSign,
  CheckCircle2,
  TrendingUp,
  Ban,
} from 'lucide-react'
import type { AdminBookingTotals } from '@/lib/api/types.gen'
import { KpiCard } from '@/features/admin/dashboard/badges'
import { formatVND } from './tickets-helpers'

/**
 * KPI cards row — totals come from the dedicated /stats endpoint
 * (`AdminBookingStatsResponse.totals`), not from the list response.
 */
export function TicketsKpiCards({
  totals,
}: {
  totals: AdminBookingTotals | undefined
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <KpiCard
        icon={<TicketIcon className="h-5 w-5" />}
        label="Tổng vé"
        value={totals ? String(totals.total) : '—'}
        change=""
        up
        color="#2563eb"
        gradient="from-blue-500/10 to-blue-600/5"
        delay={0}
      />
      <KpiCard
        icon={<DollarSign className="h-5 w-5" />}
        label="Doanh thu"
        value={totals ? formatVND(totals.revenue) : '—'}
        change=""
        up
        color="#16a34a"
        gradient="from-emerald-500/10 to-emerald-600/5"
        delay={0.05}
      />
      <KpiCard
        icon={<CheckCircle2 className="h-5 w-5" />}
        label="Đã xác nhận"
        value={totals ? String(totals.confirmed) : '—'}
        change=""
        up
        color="#0ea5e9"
        gradient="from-sky-500/10 to-sky-600/5"
        delay={0.1}
      />
      <KpiCard
        icon={<TrendingUp className="h-5 w-5" />}
        label="Hoàn thành"
        value={totals ? String(totals.completed) : '—'}
        change=""
        up
        color="#10b981"
        gradient="from-emerald-500/10 to-emerald-600/5"
        delay={0.15}
      />
      <KpiCard
        icon={<Ban className="h-5 w-5" />}
        label="Đã huỷ"
        value={totals ? String(totals.cancelled) : '—'}
        change=""
        color="#f43f5e"
        gradient="from-rose-500/10 to-rose-600/5"
        delay={0.2}
      />
    </div>
  )
}
