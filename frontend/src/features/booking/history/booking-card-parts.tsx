'use client'

// Extracted from the original 'booking-card.tsx'.

import { formatDateTimeVN } from '@/lib/types'

/* ───────────────────────────────────────────────────────────────────────
 * Small presentational helpers — kept in this file so the BookingCard is
 * fully self-contained and tree-shakeable.
 * ─────────────────────────────────────────────────────────────────────── */
export function InfoTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg ring-1 ring-black/5 p-3">
      <div className="text-[10px] uppercase font-bold tracking-wide text-muted-foreground mb-0.5 flex items-center gap-1">
        {icon}
        {label}
      </div>
      <div className="text-sm font-semibold">{value}</div>
    </div>
  )
}

export function PriceRow({
  label,
  value,
  valueClass,
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted-foreground">{label}</span>
      <span className={valueClass ?? 'font-medium'}>{value}</span>
    </div>
  )
}

export function TimelineItem({
  icon,
  label,
  time,
  active,
  destructive,
}: {
  icon: React.ReactNode
  label: string
  time: string
  active?: boolean
  destructive?: boolean
}) {
  return (
    <div className="flex items-center gap-3">
      <div
        className={`h-9 w-9 rounded-full flex items-center justify-center shrink-0 ${
          destructive
            ? 'bg-rose-100 text-rose-600'
            : active
            ? 'bg-blue-100 text-blue-600'
            : 'bg-slate-100 text-slate-400'
        }`}
      >
        {icon}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-semibold ${destructive ? 'text-rose-700' : ''}`}>{label}</div>
        <div className="text-xs text-muted-foreground">{formatDateTimeVN(time)}</div>
      </div>
    </div>
  )
}
