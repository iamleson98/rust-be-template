'use client'

/**
 * The search form's date field: a lunar calendar and, for the outbound day,
 * an optional "leaving from" time in the same panel. One trigger shows both
 * ("Thứ Hai, 12/10 · từ 08:00"). With `onClear` (the return day) the field
 * can be emptied again, which makes the search one-way.
 */

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { CalendarIcon, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { parseIsoDate } from '@/components/ui/date-picker'
import { LunarDayButton, LunarFooter } from '@/components/ui/lunar-day'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { TimeColumns } from '@/components/ui/time-picker'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'

const DAY_FMT = 'yyyy-MM-dd'

/** "Leaving from" choices: every 15 minutes is precise enough for a timetable. */
const MINUTE_STEP = 15

export function TripDatePicker({
  day,
  onDay,
  time,
  onTime,
  onClear,
  minDate,
  title,
  placeholder,
  triggerClassName,
}: {
  /** `yyyy-MM-dd` or ''. */
  day: string
  onDay: (day: string) => void
  /** `HH:MM` or '' (any time); the time panel shows only with `onTime`. */
  time?: string
  onTime?: (time: string) => void
  /** Empties the field (shows a clear button while a day is set). */
  onClear?: () => void
  minDate: Date
  /** The panel's heading on phones. */
  title: string
  placeholder: string
  triggerClassName?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const lang = usePrefs((s) => s.lang)
  const locale = lang === 'en' ? enUS : vi
  const date = parseIsoDate(day)
  const withTime = !!onTime
  const minDay = new Date(minDate.toDateString())

  const trigger = (
    <Button
      type="button"
      variant="outline"
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        'w-full justify-start gap-2 font-normal',
        !date && 'text-muted-foreground',
        onClear && date && 'pr-9',
        triggerClassName,
      )}
    >
      {date || !onClear ? (
        <CalendarIcon className="size-4 shrink-0 opacity-70" />
      ) : (
        <Plus className="size-4 shrink-0 opacity-70" />
      )}
      <span className="min-w-0 truncate">
        {date
          ? // A set time takes the room of the long weekday name.
            format(date, time ? 'EEEEEE, dd/MM' : 'EEEE, dd/MM', { locale })
          : placeholder}
      </span>
      {date && time && (
        <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-xs font-semibold text-primary tabular-nums">
          {t('search.fromTime', { time })}
        </span>
      )}
    </Button>
  )

  const calendar = (
    <Calendar
      mode="single"
      locale={locale}
      selected={date ?? undefined}
      defaultMonth={date ?? minDay}
      onSelect={(d) => {
        if (!d) return
        onDay(format(d, DAY_FMT))
        // A time may follow, so the panel stays open; a plain day is done.
        if (!withTime) setOpen(false)
      }}
      disabled={(d: Date) => d < minDay}
      className={cn('p-0 [--cell-size:--spacing(11)]', isMobile && '[--cell-size:--spacing(12)]')}
      classNames={isMobile ? { root: 'w-full' } : undefined}
      components={{ DayButton: LunarDayButton }}
      footer={<LunarFooter date={date} />}
    />
  )

  const timePanel = withTime && (
    <div className={cn('flex flex-col gap-2', isMobile ? 'border-t pt-3' : 'w-40 border-l pl-3')}>
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
        value={time ?? ''}
        minuteStep={MINUTE_STEP}
        onChange={(next) => onTime(next)}
        className={cn('justify-center', isMobile ? 'h-40' : 'h-56')}
      />
      <Button type="button" size="sm" className="mt-auto" onClick={() => setOpen(false)}>
        {t('ui.done')}
      </Button>
    </div>
  )

  const panel = (
    <div className={cn('flex gap-3', isMobile ? 'flex-col' : 'p-3')}>
      {calendar}
      {timePanel}
    </div>
  )

  return (
    <div className="relative">
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              className="max-h-[92dvh] gap-2 overflow-y-auto rounded-t-2xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="p-0">
                <SheetTitle className="text-base">{title}</SheetTitle>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>{trigger}</PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {panel}
          </PopoverContent>
        </Popover>
      )}
      {onClear && date && (
        <button
          type="button"
          aria-label={t('ui.clearDate')}
          onClick={onClear}
          className="absolute top-1/2 right-1.5 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  )
}
