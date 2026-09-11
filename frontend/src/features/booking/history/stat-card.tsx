'use client'

// Extracted from the original 'booking-stats.tsx'.

import { memo } from 'react'
import { Card, CardContent } from '@/components/ui/card'

/* ───────────────────────────────────────────────────────────────────────
 * StatCard / StatsRow — small KPI cards used at the top of each tab.
 * Extracted so my-bookings.tsx can stay focused on state + tab orchestration.
 * ─────────────────────────────────────────────────────────────────────── */

export type StatProps = {
  icon: React.ReactNode
  label: string
  value: string
  accent: string
  subtitle: string
}

export const StatCard = memo(function StatCard({ icon, label, value, accent, subtitle }: StatProps) {
  return (
    <Card className="ring-1 ring-black/5 overflow-hidden">
      <CardContent className="p-0">
        <div className={`h-1 bg-linear-to-r ${accent}`} />
        <div className="p-4 md:p-5 flex items-center gap-3.5">
          <div className={`h-11 w-11 rounded-xl bg-linear-to-br ${accent} text-white inline-flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-[10px] uppercase font-bold tracking-wider text-muted-foreground">
              {label}
            </div>
            <div className="text-lg md:text-xl font-extrabold truncate">{value}</div>
            <div className="text-[10px] text-muted-foreground">{subtitle}</div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
})
