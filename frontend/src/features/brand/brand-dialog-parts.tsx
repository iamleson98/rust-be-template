'use client'

// Extracted from the original 'brand-detail-dialog.tsx'.

export function StatCard({
  icon,
  label,
  value,
  color,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  color: string
}) {
  return (
    <div className="flex items-center gap-2.5 rounded-lg bg-white ring-1 ring-black/5 px-3 py-2">
      <div
        className="h-8 w-8 rounded-md flex items-center justify-center text-white shrink-0"
        style={{ background: color }}
      >
        {icon}
      </div>
      <div className="min-w-0">
        <div className="text-base font-bold leading-tight tabular-nums">{value}</div>
        <div className="text-[10px] text-muted-foreground uppercase tracking-wide truncate">
          {label}
        </div>
      </div>
    </div>
  )
}

export function EmptyState({
  icon,
  title,
  subtitle,
}: {
  icon: React.ReactNode
  title: string
  subtitle: string
}) {
  return (
    <div className="text-center py-10">
      <div className="inline-flex h-14 w-14 rounded-full bg-slate-100 items-center justify-center mb-3">
        {icon}
      </div>
      <h4 className="font-semibold mb-1">{title}</h4>
      <p className="text-sm text-muted-foreground max-w-md mx-auto">{subtitle}</p>
    </div>
  )
}
