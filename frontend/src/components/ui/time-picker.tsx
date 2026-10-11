'use client'

/**
 * TimePicker — a custom time field in the house style (no native
 * `<input type="time">`, whose look and keyboard differ per browser).
 *
 * The trigger reads like the DatePicker's; it opens two scrolling columns,
 * hours and minutes, in a popover (a bottom sheet on phones). The value is
 * `HH:MM` (what `departure_time` / `arrival_time` take) or `null`.
 * `TimeColumns` is shared with the DateTimePicker.
 */

import { useEffect, useRef, useState } from 'react'
import { Clock, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { useIsMobile } from '@/hooks/use-mobile'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]?\d)(?::([0-5]?\d))?$/

/** Normalize any stored time (`H:MM`, `HH:MM`, `HH:MM:SS`) to `HH:MM`; '' when invalid. */
export function normalizeTime(value: string | null | undefined): string {
  if (!value) return ''
  const m = HHMM_RE.exec(value.trim())
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`
}

const pad = (n: number) => String(n).padStart(2, '0')
const HOURS = Array.from({ length: 24 }, (_, h) => pad(h))

/**
 * Hours and minutes as two columns of choices. The minutes come in
 * `minuteStep` steps, plus the current minute when it is off that grid
 * (an older time stays visible and selected).
 */
export function TimeColumns({
  value,
  onChange,
  minuteStep = 5,
  className,
}: {
  /** `HH:MM` or ''. */
  value: string
  /** Called with the new `HH:MM`; `done` once a minute is picked. */
  onChange: (value: string, done: boolean) => void
  minuteStep?: number
  className?: string
}) {
  const t = useT()
  const [hour, minute] = value ? value.split(':') : ['', '']
  const minutes = Array.from({ length: Math.ceil(60 / minuteStep) }, (_, i) => pad(i * minuteStep))
  if (minute && !minutes.includes(minute)) minutes.push(minute)
  minutes.sort()

  return (
    <div className={cn('flex h-56 gap-1', className)}>
      <Column
        label={t('ui.hour')}
        items={HOURS}
        selected={hour}
        onPick={(h) => onChange(`${h}:${minute || '00'}`, false)}
      />
      <div className="w-px bg-border" aria-hidden />
      <Column
        label={t('ui.minute')}
        items={minutes}
        selected={minute}
        onPick={(m) => onChange(`${hour || '00'}:${m}`, true)}
      />
    </div>
  )
}

function Column({
  label,
  items,
  selected,
  onPick,
}: {
  label: string
  items: string[]
  selected: string
  onPick: (item: string) => void
}) {
  const listRef = useRef<HTMLDivElement>(null)
  // Open on the chosen value, not at 00 (scrolls the column only, never the page).
  useEffect(() => {
    const list = listRef.current
    const el = list?.querySelector<HTMLElement>('[aria-selected="true"]')
    if (list && el) list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
  }, [selected])

  return (
    <div className="flex w-16 flex-col">
      <div className="pb-1 text-center text-[11px] font-medium text-muted-foreground">{label}</div>
      <div
        ref={listRef}
        role="listbox"
        aria-label={label}
        className="flex-1 space-y-0.5 overflow-y-auto overscroll-contain px-1 scrollbar-none"
      >
        {items.map((item) => {
          const active = item === selected
          return (
            <button
              key={item}
              type="button"
              role="option"
              aria-selected={active}
              onClick={() => onPick(item)}
              className={cn(
                'flex h-8 w-full items-center justify-center rounded-lg text-sm tabular-nums transition-colors',
                active
                  ? 'bg-primary font-semibold text-primary-foreground'
                  : 'text-foreground hover:bg-muted',
              )}
            >
              {item}
            </button>
          )
        })}
      </div>
    </div>
  )
}

type TimePickerProps = {
  /** Selected time, `HH:MM`. `null`/`''` = none. */
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** Shown while no time is set. */
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Extra classes for the trigger (heights, backgrounds…). */
  triggerClassName?: string
  /** Show the clear (X) button when a time is set. Default true. */
  clearable?: boolean
  /** Minute choices; default every 5 minutes. */
  minuteStep?: number
  /** Accessible name when rendered standalone (forms label via FormControl). */
  'aria-label'?: string
  id?: string
}

export function TimePicker({
  value,
  onChange,
  placeholder,
  disabled,
  className,
  triggerClassName,
  clearable = true,
  minuteStep = 5,
  'aria-label': ariaLabel,
  id,
}: TimePickerProps) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const isMobile = useIsMobile()
  const time = normalizeTime(value)
  const label = placeholder ?? t('ui.pickTime')

  const trigger = (
    <Button
      id={id}
      type="button"
      variant="outline"
      disabled={disabled}
      aria-label={ariaLabel ? `${ariaLabel}${time ? `: ${time}` : ''}` : undefined}
      onClick={isMobile ? () => setOpen(true) : undefined}
      className={cn(
        'h-9 w-full justify-start font-normal tabular-nums',
        !time && 'text-muted-foreground',
        triggerClassName,
      )}
    >
      <Clock className="h-4 w-4 shrink-0 opacity-70" />
      {time || label}
    </Button>
  )

  const columns = (
    <TimeColumns
      value={time}
      minuteStep={minuteStep}
      onChange={(next, done) => {
        onChange(next)
        if (done) setOpen(false)
      }}
      className={isMobile ? 'h-64 justify-center' : 'p-2'}
    />
  )

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      {isMobile ? (
        <>
          {trigger}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetContent side="bottom" className="gap-2 px-4 pt-4">
              <SheetHeader className="p-0">
                <SheetTitle className="text-base">{label}</SheetTitle>
              </SheetHeader>
              {columns}
            </SheetContent>
          </Sheet>
        </>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild disabled={disabled}>
            {trigger}
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {columns}
          </PopoverContent>
        </Popover>
      )}
      {clearable && time ? (
        <button
          type="button"
          aria-label={t('ui.clearTime')}
          onClick={() => onChange(null)}
          className="flex size-8 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
