'use client'

/**
 * DatePicker — a shadcn-style single-date picker.
 *
 * `Popover` + `Calendar` (react-day-picker, Vietnamese locale) + an
 * outline-button trigger showing the formatted date. The house pattern
 * previously hand-composed at every call site (search-widget,
 * tickets-panel) — extracted here so all dates share one look, one
 * keyboard model and one null-clearing behaviour.
 *
 * Value model: `string | null` in `yyyy-MM-dd` (the wire format the
 * backend's `effective_from`/`effective_to`/date filters expect) — no
 * Date objects leak to callers.
 */

import { useMemo, useState } from 'react'
import { format, parse, isValid } from 'date-fns'
import { vi } from 'date-fns/locale'
import { CalendarIcon, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'

const ISO_FMT = 'yyyy-MM-dd'

/** Parse `yyyy-MM-dd` leniently → Date | null. */
export function parseIsoDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = parse(value.slice(0, 10), ISO_FMT, new Date())
  return isValid(d) ? d : null
}

type DatePickerProps = {
  /** Selected date, `yyyy-MM-dd`. `null`/`''` = none. */
  value: string | null | undefined
  onChange: (value: string | null) => void
  placeholder?: string
  /** Earliest selectable day (inclusive) — `yyyy-MM-dd` or Date. */
  minDate?: string | Date | null
  /** Latest selectable day (inclusive). */
  maxDate?: string | Date | null
  disabled?: boolean
  className?: string
  /** Trigger label format; default "EEEE, dd/MM/yyyy" (vi). */
  displayFormat?: string
  /** Show the clear (X) button when a date is set. Default true. */
  clearable?: boolean
  /** Extra classes for the trigger button (heights, backgrounds…). */
  triggerClassName?: string
  id?: string
}

export function DatePicker({
  value,
  onChange,
  placeholder = 'Chọn ngày…',
  minDate,
  maxDate,
  disabled,
  className,
  displayFormat = 'EEEE, dd/MM/yyyy',
  clearable = true,
  triggerClassName,
  id,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selected = parseIsoDate(value)

  const disabledDays = useMemo(() => {
    const min = minDate instanceof Date ? minDate : parseIsoDate(minDate)
    const max = maxDate instanceof Date ? maxDate : parseIsoDate(maxDate)
    return (d: Date) => (min ? d < startOfDay(min) : false) || (max ? d > endOfDay(max) : false)
  }, [minDate, maxDate])

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild disabled={disabled}>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              'w-full justify-start text-left font-normal h-9',
              !selected && 'text-muted-foreground',
              triggerClassName,
            )}
          >
            <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
            {selected ? format(selected, displayFormat, { locale: vi }) : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="single"
            locale={vi}
            selected={selected ?? undefined}
            onSelect={(d) => {
              if (!d) return
              onChange(format(d, ISO_FMT))
              setOpen(false)
            }}
            disabled={disabledDays}
            initialFocus
          />
        </PopoverContent>
      </Popover>
      {clearable && selected ? (
        <button
          type="button"
          aria-label="Xoá ngày"
          onClick={() => onChange(null)}
          className="h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}

function startOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(0, 0, 0, 0)
  return c
}

function endOfDay(d: Date): Date {
  const c = new Date(d)
  c.setHours(23, 59, 59, 999)
  return c
}
