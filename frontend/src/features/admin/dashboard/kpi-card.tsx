'use client'

/**
 * Enhanced KPI card for the dashboard KPI row.
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { Card, CardContent } from '@/components/ui/card'
import { ArrowUpRight, ArrowDownRight } from 'lucide-react'

/* ─── Enhanced KPI Card ─── */

export function KpiCard({ icon, label, value, change, up, color, gradient, delay }: {
  icon: React.ReactNode
  label: string
  value: string
  change: string
  up?: boolean
  color: string
  gradient: string
  delay: number
}) {
  return (
    <div>
      <Card className="transition-all duration-300 group overflow-hidden">
        <div className={`h-1 bg-linear-to-r ${gradient.replace('/10', '').replace('/5', '')}`} style={{ background: `linear-gradient(to right, ${color}, ${color}88)` }} />
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
          <div className={`text-xs mt-2.5 flex items-center gap-1 font-medium ${up ? 'text-blue-600' : 'text-rose-600'}`}>
            {up ? <ArrowUpRight className="h-3.5 w-3.5" /> : <ArrowDownRight className="h-3.5 w-3.5" />}
            {change}
            <span className="text-muted-foreground font-normal">so với tuần trước</span>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
