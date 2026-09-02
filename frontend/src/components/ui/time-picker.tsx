'use client'

/**
 * TimePicker — the shadcn-documented time-picker pattern
 * (ui.shadcn.com/docs/components/base/date-picker#time-picker):
 * the shared `Input` rendered as a native `<input type="time">` with the
 * browser's built-in masked time entry (typing, arrows, mobile OS pickers)
 * and exactly the styling shadcn prescribes — `appearance-none` with the
 * webkit calendar-picker indicator hidden.
 *
 * Kept from the house pattern: the controlled `string | null` value model
 * in `HH:MM` (what the backend's `departure_time` / per-point
 * `arrival_time` accept — so no `step` is set, keeping minute precision),
 * the leading Clock glyph (pairs with DatePicker's CalendarIcon) and the
 * clear (X) affordance for optional fields.
 */

import { Clock, X } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]?\d)(?::([0-5]?\d))?$/

/** Normalize any stored time (`H:MM`, `HH:MM`, `HH:MM:SS`) to `HH:MM`. */
function toInputValue(value: string | null | undefined): string {
  if (!value) return ''
  const m = HHMM_RE.exec(value.trim())
  if (!m) return ''
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`
}

type TimePickerProps = {
  /** Selected time, `HH:MM`. `null`/`''` = none. */
  value: string | null | undefined
  onChange: (value: string | null) => void
  /** Native time inputs ignore `placeholder` (the browser shows its own
   *  mask). Accepted for API compatibility with earlier usages. */
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Show the clear (X) button when a time is set. Default true. */
  clearable?: boolean
  /** Accessible name when rendered standalone (forms label via FormControl). */
  'aria-label'?: string
  id?: string
}

export function TimePicker({
  value,
  onChange,
  disabled,
  className,
  clearable = true,
  'aria-label': ariaLabel,
  id,
}: TimePickerProps) {
  const time = toInputValue(value)

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <div className="relative w-full">
        <Clock className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/70" />
        {/* The docs' time picker: a styled native `<input type="time">`
            (appearance-none, hidden webkit indicator). Omitting `step`
            keeps the browser at minute precision — `HH:MM` on the wire. */}
        <Input
          type="time"
          id={id}
          disabled={disabled}
          aria-label={ariaLabel}
          value={time}
          onChange={(e) => {
            const v = e.target.value
            onChange(v ? v.slice(0, 5) : null)
          }}
          className={cn(
            'h-9 pl-9 tabular-nums appearance-none bg-background',
            '[&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none',
          )}
        />
      </div>
      {clearable && time ? (
        <button
          type="button"
          aria-label="Xoá giờ"
          onClick={() => onChange(null)}
          className="h-6 w-6 shrink-0 rounded text-muted-foreground hover:text-foreground hover:bg-slate-100 dark:hover:bg-slate-800 flex items-center justify-center"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  )
}
