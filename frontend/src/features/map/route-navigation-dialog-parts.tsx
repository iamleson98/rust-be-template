'use client'

// Extracted from the original 'route-navigation-dialog.tsx'.

// ── Small presentational helpers ─────────────────────────────

export function StatusBanner({
  icon,
  text,
  tone,
}: {
  icon: React.ReactNode
  text: string
  tone: 'info' | 'warn' | 'error'
}) {
  const toneCls =
    tone === 'warn'
      ? 'ring-amber-200 bg-amber-50 text-amber-900'
      : tone === 'error'
        ? 'ring-rose-200 bg-rose-50 text-rose-900'
        : 'ring-blue-200 bg-blue-50 text-blue-900'
  return (
    <div className={`rounded-xl ring-1 ${toneCls} p-3 flex items-center gap-2.5 text-sm`}>
      {icon}
      <span>{text}</span>
    </div>
  )
}

export function StatTile({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode
  label: string
  value: string
  tone: 'blue' | 'amber' | 'emerald' | 'slate'
}) {
  const toneCls =
    tone === 'blue'
      ? 'bg-blue-50 text-blue-700'
      : tone === 'amber'
        ? 'bg-amber-50 text-amber-700'
        : tone === 'emerald'
          ? 'bg-blue-50 text-blue-700'
          : 'bg-slate-100 text-slate-700'
  return (
    <div className="rounded-lg ring-1 ring-black/5 bg-white p-3">
      <div className={`h-7 w-7 rounded-md ${toneCls} inline-flex items-center justify-center mb-1.5`}>
        {icon}
      </div>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className="text-sm font-bold text-foreground tabular-nums">{value}</div>
    </div>
  )
}
