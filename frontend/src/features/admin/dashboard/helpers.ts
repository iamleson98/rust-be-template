/**
 * Pure helpers for the AdminDashboard module.
 *
 *   - downloadCSV: triggers a browser-side file download for the CSV text
 *     returned by `/api/admin/bookings/export`.
 *   - formatVNDShort / formatVNDMillions: compact VND labels for chart
 *     cards.
 *   - periodDays / previousPeriod / percentChange / revenueBars: the
 *     reporting period, the one before it, and the revenue chart's bars.
 */

import { differenceInCalendarDays, eachDayOfInterval, format, parseISO, subDays } from 'date-fns'

/** Triggers a browser-side file download for the given text content. */
export function downloadCSV(filename: string, content: string) {
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/* ── Compact VND formatters for the dashboard chart cards ────────
 * Extracted from the original 'stats-overview.tsx'. */

export function formatVNDShort(n: number | null | undefined): string {
  if (n == null) return '—'
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)} tỷ₫`
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)} triệu₫`
  return new Intl.NumberFormat('vi-VN').format(n) + '₫'
}

export function formatVNDMillions(n: number | null | undefined): string {
  if (n == null) return '0'
  return (n / 1_000_000).toFixed(1)
}

/* ── Reporting periods ──────────────────────────────────────────── */

export type Period = { dateFrom: string; dateTo: string }

const ymd = (d: Date) => format(d, 'yyyy-MM-dd')

/** Every day of `period`, oldest first (`yyyy-MM-dd`). */
export function periodDays({ dateFrom, dateTo }: Period): string[] {
  return eachDayOfInterval({ start: parseISO(dateFrom), end: parseISO(dateTo) }).map(ymd)
}

/** The period of the same length that ends the day before `period` starts. */
export function previousPeriod({ dateFrom, dateTo }: Period): Period {
  const start = parseISO(dateFrom)
  const length = differenceInCalendarDays(parseISO(dateTo), start) + 1
  return { dateFrom: ymd(subDays(start, length)), dateTo: ymd(subDays(start, 1)) }
}

/** Percent change from `before` to `now`; `null` when there is nothing to compare against. */
export function percentChange(now: number, before: number): number | null {
  return before > 0 ? ((now - before) / before) * 100 : null
}

/**
 * Daily revenue over `days` (missing days count as 0), in at most `maxBars`
 * bars: one per day while they fit, else consecutive days summed per bar,
 * each labelled by its first day.
 */
export function revenueBars(
  days: string[],
  revenueByDay: Map<string, number>,
  maxBars: number,
  label: (day: string) => string,
): { label: string; value: number; date: string }[] {
  const size = Math.max(1, Math.ceil(days.length / maxBars))
  const bars: { label: string; value: number; date: string }[] = []
  for (let i = 0; i < days.length; i += size) {
    const slice = days.slice(i, i + size)
    bars.push({
      label: label(slice[0]),
      value: slice.reduce((sum, day) => sum + (revenueByDay.get(day) ?? 0), 0),
      date: slice[0],
    })
  }
  return bars
}
