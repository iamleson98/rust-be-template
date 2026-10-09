import type { ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

const TONES = {
  blue: 'bg-blue-50 text-blue-600 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-50 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300',
  violet: 'bg-violet-50 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300',
  rose: 'bg-rose-50 text-rose-600 dark:bg-rose-500/15 dark:text-rose-300',
  sky: 'bg-sky-50 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300',
} as const

export type StatTone = keyof typeof TONES

/**
 * One headline number. Label on top, the number large, one quiet line under
 * it; the icon is a small tinted badge that never squeezes the text. Sized
 * by its own width, so two to a row on a phone still read cleanly.
 */
export function StatTile({
  label,
  value,
  hint,
  icon,
  tone = 'blue',
  trend,
  onClick,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  tone?: StatTone
  /** Change against the previous period, in percent; `null` (nothing to compare) shows nothing. */
  trend?: { delta: number | null; label: string }
  /** Makes the tile a button (to the list it summarises). */
  onClick?: () => void
}) {
  const body = (
    <>
      {/* Two lines kept for the label, so values line up across a row. */}
      <div className="flex min-h-8 items-start gap-2">
        <span className="line-clamp-2 min-w-0 flex-1 text-xs leading-4 font-medium text-muted-foreground">
          {label}
        </span>
        {icon && (
          <span
            className={cn(
              'grid size-7 shrink-0 place-items-center rounded-md [&_svg]:size-4',
              TONES[tone],
            )}
            aria-hidden
          >
            {icon}
          </span>
        )}
      </div>
      <div className="mt-1 truncate text-xl font-semibold tracking-tight tabular-nums @[11rem]:text-2xl">
        {value}
      </div>
      {(hint || trend?.delta != null) && (
        <div className="mt-1 flex min-w-0 items-start gap-1 text-xs leading-4 text-muted-foreground">
          {trend?.delta != null && <Trend delta={trend.delta} label={trend.label} />}
          {hint && <span className="line-clamp-2 min-w-0">{hint}</span>}
          {onClick && (
            <ChevronRight className="mt-px ml-auto size-3.5 shrink-0 opacity-50" aria-hidden />
          )}
        </div>
      )}
    </>
  )
  const frame =
    '@container flex flex-col rounded-xl border bg-card p-4 text-left text-card-foreground'
  return onClick ? (
    <button
      type="button"
      onClick={onClick}
      className={cn(frame, 'transition-colors hover:border-primary/40 hover:bg-primary/[0.03]')}
    >
      {body}
    </button>
  ) : (
    <div className={frame}>{body}</div>
  )
}

/** "↑ 12.5% vs previous period", green up, red down. */
function Trend({ delta, label }: { delta: number; label: string }) {
  const up = delta >= 0
  const Arrow = up ? ArrowUpRight : ArrowDownRight
  return (
    <span className="flex min-w-0 items-center gap-1">
      <span
        className={cn(
          'inline-flex shrink-0 items-center font-medium tabular-nums',
          up ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400',
        )}
      >
        <Arrow className="size-3.5" aria-hidden />
        {Math.abs(delta).toFixed(1)}%
      </span>
      <span className="truncate">{label}</span>
    </span>
  )
}

/** Stat tiles: two to a row on phones, four on wide screens. */
export function StatGrid({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('grid grid-cols-2 gap-3 lg:grid-cols-4', className)}>{children}</div>
}
