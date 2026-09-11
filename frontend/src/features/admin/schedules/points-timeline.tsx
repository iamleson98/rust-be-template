'use client'

/**
 * Vertical timeline of a schedule's ordered address points (điểm khởi
 * hành → các điểm trung gian → điểm kết thúc) — the schedule's actual
 * pickup/drop sequence.
 *
 * Extracted from the original 'src/routes/admin/schedules.tsx'.
 */

import { CircleDot, Clock, Flag, MapPin } from 'lucide-react'
import type { AdminScheduleOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'

const KIND_STYLE = {
  pickup: { dot: 'bg-blue-600 border-blue-200', line: 'bg-blue-200', icon: CircleDot, iconClass: 'text-blue-600' },
  middle: { dot: 'bg-amber-500 border-amber-200', line: 'bg-amber-200', icon: MapPin, iconClass: 'text-amber-600' },
  drop: { dot: 'bg-rose-600 border-rose-200', line: 'bg-rose-200', icon: Flag, iconClass: 'text-rose-600' },
} as const

const KIND_LABEL = { pickup: 'Khởi hành', middle: 'Trung gian', drop: 'Kết thúc' } as const

export function PointsTimeline({ points }: { points: AdminScheduleOut['points'] }) {
  if (!points || points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Chưa cấu hình điểm đón — trả cho lịch trình này.
      </p>
    )
  }
  return (
    <ol className="relative space-y-0">
      {points.map((p, i) => {
        const style = KIND_STYLE[(p.kind as keyof typeof KIND_STYLE) ?? 'middle'] ?? KIND_STYLE.middle
        const isLast = i === points.length - 1
        return (
          <li key={p.id} className="relative flex items-start gap-3 pb-3 last:pb-0">
            {/* Vertical connector */}
            {!isLast && (
              <span
                aria-hidden
                className={cn('absolute left-2.25 top-5 bottom-0 w-0.5', style.line)}
              />
            )}
            <span
              className={cn(
                'relative z-10 mt-0.5 h-4.75 w-4.75 shrink-0 rounded-full border-[3px] flex items-center justify-center',
                style.dot,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium truncate leading-5">
                <span className="truncate">{p.address.name}</span>
                {p.arrivalTime ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    title="Giờ xe dự kiến tới"
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {p.arrivalTime}
                  </span>
                ) : null}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {KIND_LABEL[(p.kind as keyof typeof KIND_LABEL) ?? 'middle']}
                {p.address.province ? ` · ${p.address.province}` : ''}
                {p.address.district ? ` · ${p.address.district}` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
