/**
 * What opens from the trip date field: the lunar calendar and, for the outbound
 * day, the "leaving from" time columns. Loaded on first open (see
 * `trip-date-picker.tsx`).
 */

import { format } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { LunarDayButton, LunarFooter } from '@/components/ui/lunar-day'
import { TimeColumns } from '@/components/ui/time-picker'
import { useT, type Lang } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const DAY_FMT = 'yyyy-MM-dd'

/** "Leaving from" choices: every 15 minutes is precise enough for a timetable. */
const MINUTE_STEP = 15

export function TripDatePanel({
  date,
  minDay,
  lang,
  isMobile,
  time,
  onTime,
  onDay,
  onDone,
}: {
  date: Date | null
  minDay: Date
  lang: Lang
  isMobile: boolean
  /** `HH:MM` or '' (any time); undefined hides the time columns. */
  time?: string
  onTime?: (time: string) => void
  /** A picked day; `keepOpen` while a time may still follow. */
  onDay: (day: string, keepOpen: boolean) => void
  onDone: () => void
}) {
  const t = useT()
  const withTime = time !== undefined && !!onTime

  return (
    <div className={cn('flex gap-3', isMobile ? 'flex-col' : 'p-3')}>
      <Calendar
        mode="single"
        locale={lang === 'en' ? enUS : vi}
        selected={date ?? undefined}
        defaultMonth={date ?? minDay}
        onSelect={(d) => {
          if (!d) return
          onDay(format(d, DAY_FMT), withTime)
        }}
        disabled={(d: Date) => d < minDay}
        className={cn('p-0 [--cell-size:--spacing(11)]', isMobile && '[--cell-size:--spacing(12)]')}
        classNames={isMobile ? { root: 'w-full' } : undefined}
        components={{ DayButton: LunarDayButton }}
        footer={<LunarFooter date={date} />}
      />
      {withTime && (
        <div
          className={cn('flex flex-col gap-2', isMobile ? 'border-t pt-3' : 'w-40 border-l pl-3')}
        >
          <div className="text-xs font-semibold text-slate-700">{t('search.time')}</div>
          <button
            type="button"
            aria-pressed={!time}
            onClick={() => onTime('')}
            className={cn(
              'h-8 rounded-lg border text-sm font-medium transition-colors',
              time
                ? 'border-border text-foreground hover:border-primary/40'
                : 'border-primary bg-primary text-primary-foreground',
            )}
          >
            {t('search.anyTime')}
          </button>
          <TimeColumns
            value={time}
            minuteStep={MINUTE_STEP}
            onChange={(next) => onTime(next)}
            className={cn('justify-center', isMobile ? 'h-40' : 'h-56')}
          />
          <Button type="button" size="sm" className="mt-auto" onClick={onDone}>
            {t('ui.done')}
          </Button>
        </div>
      )}
    </div>
  )
}
