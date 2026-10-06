'use client'

/**
 * Enhanced KPI card for the dashboard KPI row.
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { useT } from '@/lib/i18n'

/* ─── Enhanced KPI Card ─── */

export function KpiCard({
  icon,
  label,
  value,
  change,
  up,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string
  change: string
  up?: boolean
  color: string
}) {
  const t = useT()
  return (
    <div>
      <Card className="transition-all duration-300 group overflow-hidden">
        <CardContent className="p-5">
          <div className="flex items-start justify-between">
            <div>
              <div className="text-xs text-muted-foreground font-medium mb-1">{label}</div>
              <div className="text-2xl font-extrabold tracking-tight">{value}</div>
            </div>
            <div
              className="h-11 w-11 rounded-xl flex items-center justify-center transition-transform duration-300"
              style={{ background: `${color}15`, color }}
            >
              {icon}
            </div>
          </div>
          <div
            className={`text-xs mt-2.5 flex items-center gap-1 font-medium ${up ? 'text-blue-600' : 'text-rose-600'}`}
          >
            {up ? (
              <ArrowUpRight className="h-3.5 w-3.5" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5" />
            )}
            {change}
            <span className="text-muted-foreground font-normal">{t('adminDash.vsLastWeek')}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
