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

import { usePrefs } from '@/stores/prefs'
import { useMemo, useState } from 'react'
import { format, parse, isValid } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { CalendarIcon, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { LunarDayButton, LunarFooter } from '@/components/ui/lunar-day'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
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
  /** Show the Vietnamese lunar date under each day, and the holidays. */
  lunar?: boolean
}

export function DatePicker({
  value,
  onChange,
  placeholder,
  minDate,
  maxDate,
  disabled,
  className,
  displayFormat,
  clearable = true,
  triggerClassName,
  id,
  lunar = false,
}: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const selected = parseIsoDate(value)
  const t = useT()
  // Calendar locale + weekday names follow the VI/EN app language.
  const lang = usePrefs((s) => s.lang)
  const dateLocale = lang === 'en' ? enUS : vi
  const effectiveFormat = displayFormat ?? (lang === 'en' ? 'EEEE, MM/dd/yyyy' : 'EEEE, dd/MM/yyyy')
  const effectivePlaceholder = placeholder ?? t('ui.pickDate')

  const disabledDays = useMemo(() => {
    const min = minDate instanceof Date ? minDate : parseIsoDate(minDate)
    const max = maxDate instanceof Date ? maxDate : parseIsoDate(maxDate)
    return (d: Date) => (min ? d < startOfDay(min) : false) || (max ? d > endOfDay(max) : false)
  }, [minDate, maxDate])

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      // Phones open the sheet; larger screens let the popover trigger handle it.
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        'w-full justify-start text-left font-normal h-9',
        !selected && 'text-muted-foreground',
        triggerClassName,
      )}
    >
      <CalendarIcon className="h-4 w-4 shrink-0 opacity-70" />
      {selected ? format(selected, effectiveFormat, { locale: dateLocale }) : effectivePlaceholder}
    </Button>
  )

  const calendar = (
    <Calendar
      mode="single"
      locale={dateLocale}
      className={cn(
        // Lunar days need a second line: taller cells (also better touch targets).
        lunar && '[--cell-size:--spacing(11)]',
        isMobile && 'p-0 [--cell-size:--spacing(12)]',
      )}
      classNames={isMobile ? { root: 'w-full' } : undefined}
      components={lunar ? { DayButton: LunarDayButton } : undefined}
      footer={lunar ? <LunarFooter date={selected} /> : undefined}
      selected={selected ?? undefined}
      onSelect={(d) => {
        if (!d) return
        onChange(format(d, ISO_FMT))
        setOpen(false)
      }}
      disabled={disabledDays}
      initialFocus
    />
  )

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {/* Phones: a bottom sheet with a full-width calendar (a popover runs
          off the screen); larger screens: a popover under the field. */}
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent
              side="bottom"
              className="gap-2 rounded-t-2xl px-4 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
            >
              <SheetHeader className="p-0">
                <SheetTitle className="text-base">{effectivePlaceholder}</SheetTitle>
              </SheetHeader>
              {calendar}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            {trigger}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {calendar}
          </PopoverContent>
        </Popover>
      )}
      {clearable && selected ? (
        <button
          type="button"
          aria-label={t('ui.clearDate')}
          onClick={() => onChange(null)}
          className="size-8 shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-accent flex items-center justify-center"
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
