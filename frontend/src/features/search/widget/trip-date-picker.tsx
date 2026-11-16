/**
 * The search form's date field: a lunar calendar and, for the outbound day,
 * an optional "leaving from" time in the same panel. One trigger shows both
 * ("Thứ Hai, 12/10 · từ 08:00"). With `onClear` (the return day) the field
 * can be emptied again, which makes the search one-way.
 */

import { lazy, Suspense, useState } from 'react'
import { format } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { CalendarIcon, Plus, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
import { parseIsoDate } from '@/lib/iso-date'
import { cn } from '@/lib/utils'
import { usePrefs } from '@/stores/prefs'

// The calendar and the time columns weigh more than the field that opens them:
// they load when the panel does.
const TripDatePanel = lazy(() =>
  import('./trip-date-panel').then((m) => ({ default: m.TripDatePanel })),
)

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

  const panel = (
    <Suspense fallback={<div className={isMobile ? 'h-80' : 'h-80 w-72'} aria-busy="true" />}>
      <TripDatePanel
        date={date}
        minDay={minDay}
        locale={locale}
        isMobile={isMobile}
        time={withTime ? (time ?? '') : undefined}
        onTime={onTime}
        onDay={(day, keepOpen) => {
          onDay(day)
          if (!keepOpen) setOpen(false)
        }}
        onDone={() => setOpen(false)}
      />
    </Suspense>
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
