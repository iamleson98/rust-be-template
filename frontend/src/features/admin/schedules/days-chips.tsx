'use client'

/**
 * Day-of-week chips rendered from a schedule's 7-char `daysOfWeek`
 * bitmask (`1111111` = every day).
 *
 * Extracted from the original 'src/routes/admin/schedules.tsx'.
 */

import { DAY_LABELS } from '@/features/admin/types'
import { cn } from '@/lib/utils'

export function DaysChips({ daysOfWeek }: { daysOfWeek?: string | null }) {
  const mask = daysOfWeek ?? '1111111'
  const allOn = mask === '1111111'
  return (
    <span className="flex flex-wrap gap-0.5">
      {DAY_LABELS.map((label, i) => (
        <span
          key={i}
          className={cn(
            'px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums',
            mask[i] === '1'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-slate-100 text-slate-400',
          )}
        >
          {label}
        </span>
      ))}
      {allOn ? (
        <span className="ml-1 text-[10px] text-muted-foreground self-center">hàng ngày</span>
      ) : null}
    </span>
  )
}
