'use client'

/**
 * TimePicker — a shadcn-style `HH:MM` picker.
 *
 * `Popover` + two existing `Select`s (hour 00–23, minute 00–59) with a
 * `Clock` trigger button. Chosen over a native `<input type="time">`
 * for consistent styling/keyboard behaviour across browsers and over a
 * clock-face widget for mobile-friendly scroll lists.
 *
 * Value model: `string | null` in `HH:MM` — exactly what the backend's
 * `departure_time` / per-point `arrival_time` fields accept.
 */

import { Clock, X } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

const HOURS = Array.from({ length: 24 }, (_, h) => String(h).padStart(2, '0'))
const MINUTES = Array.from({ length: 60 }, (_, m) => String(m).padStart(2, '0'))

const HHMM_RE = /^([01]?\d|2[0-3]):([0-5]?\d)$/

/** Split an `HH:MM` value leniently → [hour, minute] (zero-padded). */
function splitTime(value: string | null | undefined): [string, string] | null {
  if (!value) return null
  const m = HHMM_RE.exec(value.trim())
  if (!m) return null
  return [m[1].padStart(2, '0'), m[2].padStart(2, '0')]
}

type TimePickerProps = {
  /** Selected time, `HH:MM`. `null`/`''` = none. */
  value: string | null | undefined
  onChange: (value: string | null) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  /** Show the clear (X) button when a time is set. Default true. */
  clearable?: boolean
  id?: string
}

export function TimePicker({
  value,
  onChange,
  placeholder = '--:--',
  disabled,
  className,
  clearable = true,
  id,
}: TimePickerProps) {
  const time = splitTime(value)
  const hour = time?.[0] ?? ''
  const minute = time?.[1] ?? ''

  const setPart = (h: string, m: string) => {
    if (h && m) onChange(`${h}:${m}`)
    else if (h && !m) onChange(null) // half-picked — keep null until complete
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <Popover>
        <PopoverTrigger asChild disabled={disabled}>
          <Button
            id={id}
            type="button"
            variant="outline"
            className={cn(
              'w-full justify-start text-left font-normal h-9 tabular-nums',
              !time && 'text-muted-foreground',
            )}
          >
            <Clock className="h-4 w-4 shrink-0 opacity-70" />
            {time ? `${hour}:${minute}` : placeholder}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-3" align="start">
          <div className="flex items-center gap-2">
            <Select
              value={hour}
              onValueChange={(h) => setPart(h, minute)}
            >
              <SelectTrigger size="sm" className="w-16 tabular-nums" aria-label="Giờ">
                <SelectValue placeholder="HH" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {HOURS.map((h) => (
                  <SelectItem key={h} value={h} className="tabular-nums">
                    {h}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-sm text-muted-foreground">:</span>
            <Select
              value={minute}
              onValueChange={(m) => setPart(hour, m)}
            >
              <SelectTrigger size="sm" className="w-16 tabular-nums" aria-label="Phút">
                <SelectValue placeholder="MM" />
              </SelectTrigger>
              <SelectContent className="max-h-64">
                {MINUTES.map((m) => (
                  <SelectItem key={m} value={m} className="tabular-nums">
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </PopoverContent>
      </Popover>
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
