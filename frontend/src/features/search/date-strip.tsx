import { ChevronLeft, ChevronRight } from 'lucide-react'
import { formatDateVN } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { vnDate } from '@/lib/search-params'
import { cn } from '@/lib/utils'

const DAYS = 7

/** `YYYY-MM-DD` plus `n` days (calendar arithmetic, time zone free). */
const addDays = (day: string, n: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)

/**
 * A week of dates around the chosen one: change the travel day in one tap,
 * the way people compare "tonight or tomorrow morning". Never before today.
 */
export function DateStrip({ date, onPick }: { date: string; onPick: (day: string) => void }) {
  const t = useT()
  const today = vnDate()
  const start = [addDays(date, -3), today].sort()[1]
  const days = Array.from({ length: DAYS }, (_, i) => addDays(start, i))

  const step = (n: number) => {
    const next = addDays(date, n)
    if (next >= today) onPick(next)
  }

  return (
    <div className="flex items-center gap-2">
      <button
        type="button"
        onClick={() => step(-1)}
        disabled={date <= today}
        aria-label={t('searchPage.previousDay')}
        className="hidden size-9 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-primary disabled:opacity-40 sm:grid"
      >
        <ChevronLeft className="size-4" />
      </button>
      <div className="-mx-4 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
        {days.map((day) => {
          const active = day === date
          return (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-pressed={active}
              className={cn(
                'flex min-w-17 flex-1 flex-col items-center rounded-xl px-2 py-1.5 transition-colors',
                active
                  ? 'bg-primary text-primary-foreground shadow-soft'
                  : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-primary/40',
              )}
            >
              <span
                className={cn(
                  'text-[11px]',
                  active ? 'text-primary-foreground/85' : 'text-slate-500',
                )}
              >
                {day === today ? t('searchPage.today') : formatDateVN(day, { weekday: 'short' })}
              </span>
              <span className="text-sm font-semibold tabular-nums">
                {day.slice(8)}/{day.slice(5, 7)}
              </span>
            </button>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => step(1)}
        aria-label={t('searchPage.nextDay')}
        className="hidden size-9 shrink-0 place-items-center rounded-full bg-white text-slate-600 ring-1 ring-slate-200 transition-colors hover:text-primary sm:grid"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  )
}
