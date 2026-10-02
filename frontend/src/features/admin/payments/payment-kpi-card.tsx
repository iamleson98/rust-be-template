'use client'

/**
 * KPI summary card of the admin payments panel.
 *
 * Extracted from the original 'src/features/admin/payments/payments-panel.tsx'.
 */

import { Card, CardContent } from '@/components/ui/card'

export function KpiCard({
  icon,
  label,
  value,
  color,
  hint,
}: {
  icon: React.ReactNode
  label: string
  value: string
  color: string
  /** Small qualifier under the value (e.g. "current page only"). */
  hint?: string
}) {
  return (
    <Card>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-center gap-2">
          <div className={`flex items-center justify-center h-8 w-8 rounded-lg ${color}`}>
            {icon}
          </div>
          <div className="min-w-0">
            <div className="text-[11px] text-muted-foreground truncate">{label}</div>
            <div className="text-base font-bold tabular-nums truncate">{value}</div>
            {hint && <div className="text-[10px] text-muted-foreground/80 truncate">{hint}</div>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
