'use client'

/**
 * DateTimePicker — a day and a time in one field, in the house style (no
 * native `datetime-local`). The value is a wall-clock `yyyy-MM-ddTHH:mm`.
 *
 * The panel puts the calendar beside the time columns (stacked in a bottom
 * sheet on phones); picking a day keeps the time and picking a time keeps
 * the day, and "Xong" closes it.
 */

import { useState } from 'react'
import { format } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { CalendarClock } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { parseIsoDate } from '@/components/ui/date-picker'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { normalizeTime, TimeColumns } from '@/components/ui/time-picker'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'

const DAY_FMT = 'yyyy-MM-dd'

/** `yyyy-MM-ddTHH:mm` → its day and time parts ('' when missing). */
function split(value: string | null | undefined): { day: string; time: string } {
  if (!value) return { day: '', time: '' }
  const [day = '', time = ''] = value.split('T')
  return { day: parseIsoDate(day) ? day.slice(0, 10) : '', time: normalizeTime(time) }
}

export function DateTimePicker({
  value,
  onChange,
  placeholder,
  minDate,
  disabled,
  className,
  triggerClassName,
  defaultTime = '08:00',
  minuteStep = 5,
  id,
  'aria-label': ariaLabel,
}: {
  /** `yyyy-MM-ddTHH:mm`; `null`/`''` = none. */
  value: string | null | undefined
  onChange: (value: string) => void
  placeholder?: string
  /** Earliest selectable day (inclusive). */
  minDate?: Date
  disabled?: boolean
  className?: string
  triggerClassName?: string
  /** The time used when a day is picked before any time. */
  defaultTime?: string
  minuteStep?: number
  id?: string
  'aria-label'?: string
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const lang = usePrefs((s) => s.lang)
  const locale = lang === 'en' ? enUS : vi
  const { day, time } = split(value)
  const date = parseIsoDate(day)
  const label = placeholder ?? t('ui.pickDateTime')

  const emit = (nextDay: string, nextTime: string) =>
    onChange(`${nextDay || format(minDate ?? new Date(), DAY_FMT)}T${nextTime || defaultTime}`)

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={ariaLabel}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        'h-9 w-full justify-start font-normal tabular-nums',
        !date && 'text-muted-foreground',
        triggerClassName,
      )}
    >
      <CalendarClock className="h-4 w-4 shrink-0 opacity-70" />
      <span className="truncate">
        {date
          ? `${format(date, lang === 'en' ? 'EEE, MM/dd/yyyy' : 'EEE, dd/MM/yyyy', { locale })} · ${time || defaultTime}`
          : label}
      </span>
    </Button>
  )

  const panel = (
    <div className={cn('flex gap-3', isMobile ? 'flex-col' : 'p-3')}>
      <Calendar
        mode="single"
        locale={locale}
        selected={date ?? undefined}
        defaultMonth={date ?? minDate}
        onSelect={(d) => d && emit(format(d, DAY_FMT), time)}
        disabled={minDate ? (d: Date) => d < new Date(minDate.toDateString()) : undefined}
        className={cn('p-0', isMobile && '[--cell-size:--spacing(11)]')}
        classNames={isMobile ? { root: 'w-full' } : undefined}
      />
      <div className={cn('flex flex-col', !isMobile && 'border-l pl-3')}>
        <TimeColumns
          value={time}
          minuteStep={minuteStep}
          onChange={(next) => emit(day, next)}
          className={cn('flex-1', isMobile && 'h-48 justify-center')}
        />
        <Button type="button" size="sm" className="mt-2" onClick={() => setOpen(false)}>
          {t('ui.done')}
        </Button>
      </div>
    </div>
  )

  return (
    <div className={className}>
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="gap-2 px-4 pt-4">
              <SheetHeader className="p-0">
                <SheetTitle className="text-base">{label}</SheetTitle>
              </SheetHeader>
              {panel}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            {trigger}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {panel}
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
