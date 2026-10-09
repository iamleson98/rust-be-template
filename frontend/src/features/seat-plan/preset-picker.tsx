'use client'

import { LayoutTemplate } from 'lucide-react'
import type { BusLayoutPreset } from '@/api'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import { PlanThumbnail } from './plan-thumbnail'

/** Template gallery: ready-made plans for common vehicles, plus a blank canvas. */
export function PresetPicker({
  presets,
  loading,
  onPick,
  onBlank,
  busy,
}: {
  presets: readonly BusLayoutPreset[]
  loading?: boolean
  onPick: (preset: BusLayoutPreset) => void
  /** Offer "start from an empty plan" (creation only). */
  onBlank?: () => void
  busy?: boolean
}) {
  const t = useT()
  const card =
    'flex flex-col gap-2 rounded-lg border p-3 text-left transition-colors hover:border-blue-300 hover:bg-blue-50/40 disabled:pointer-events-none disabled:opacity-60'
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {onBlank && (
        <button
          type="button"
          className={cn(card, 'items-center justify-center text-center')}
          onClick={onBlank}
        >
          <LayoutTemplate className="h-8 w-8 text-muted-foreground" />
          <span className="text-sm font-semibold">{t('seatPlan.presets.blank')}</span>
          <span className="text-xs text-muted-foreground">{t('seatPlan.presets.blankDesc')}</span>
        </button>
      )}
      {loading
        ? Array.from({ length: 6 }, (_, i) => <Skeleton key={i} className="h-44 rounded-lg" />)
        : presets.map((p) => (
            <button
              key={p.id}
              type="button"
              className={card}
              disabled={busy}
              onClick={() => onPick(p)}
            >
              <div className="flex min-h-24 flex-1 items-center justify-center">
                <PlanThumbnail plan={p.plan} />
              </div>
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className="shrink-0 text-xs font-medium text-blue-700 tabular-nums">
                    {t('seatPlan.presets.seats', { count: p.capacity })}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">{p.description}</p>
              </div>
            </button>
          ))}
    </div>
  )
}
