import { useCallback } from 'react'
import { localeOf, translate } from '@/lib/i18n'
import { usePrefs, type Currency } from '@/stores/prefs'

export type { Currency }

const lang = () => usePrefs.getState().lang
const locale = () => localeOf(lang())

// ── Numbers & money ──────────────────────────────────────────

export const formatNum = (n: number) => new Intl.NumberFormat(locale()).format(n)

export const formatVND = (amount: number) =>
  new Intl.NumberFormat(locale(), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount)

/** Display-only rate: amounts are stored in VND, USD is a presentation layer. */
export const EXCHANGE_RATE = 24_500

export const formatCurrency = (amountVND: number, currency: Currency) =>
  currency === 'USD'
    ? new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amountVND / EXCHANGE_RATE)
    : formatVND(amountVND)

/** `formatCurrency` in the visitor's chosen currency, for components. */
export function useMoney() {
  const currency = usePrefs((s) => s.currency)
  return useCallback((amountVND: number) => formatCurrency(amountVND, currency), [currency])
}

export const exchangeRateNote = () =>
  translate(lang(), 'common.exchangeRateNote', {
    rate: EXCHANGE_RATE.toLocaleString(locale()),
  })

// ── Durations ────────────────────────────────────────────────

/** Minutes → "45 phút" / "2h 30p" / "1 ngày 3h"; "—" for missing values. */
export function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—'
  const en = lang() === 'en'
  if (min < 60) return en ? `${min} min` : `${min} phút`
  const days = Math.floor(min / (24 * 60))
  const hours = Math.floor((min % (24 * 60)) / 60)
  const mins = min % 60
  if (days > 0) {
    const unit = en ? 'd' : 'ngày'
    return mins > 0 ? `${days} ${unit} ${hours}h ${mins}p` : `${days} ${unit} ${hours}h`
  }
  return mins > 0 ? `${hours}h ${mins}p` : `${hours}h`
}

// ── Dates & times ────────────────────────────────────────────

const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/
const TIME_ZONE = 'Asia/Ho_Chi_Minh'

/**
 * Parse defensively → null when empty/invalid. The backend emits
 * timezone-less ISO datetimes meaning Vietnam local time, so they are pinned
 * to +07:00 (JS would otherwise read them in the browser's zone and shift
 * evening departures to the next day).
 */
export function parseDateSafe(value: string | Date | null | undefined): Date | null {
  if (value == null) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const date = new Date(NAIVE_DATETIME.test(value) ? `${value}+07:00` : value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDateVN(
  value: string | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  },
): string {
  const date = parseDateSafe(value)
  return date
    ? new Intl.DateTimeFormat(locale(), { timeZone: TIME_ZONE, ...options }).format(date)
    : ''
}

export function formatTimeVN(value: string | Date | null | undefined): string {
  const date = parseDateSafe(value)
  return date
    ? new Intl.DateTimeFormat(locale(), {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        timeZone: TIME_ZONE,
      }).format(date)
    : '—'
}

const DMY: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' }

/** `10/10/2026`, or "—" for a missing/invalid value. */
export const formatDay = (value: string | Date | null | undefined) =>
  formatDateVN(value, DMY) || '—'

/** `08:30 10/10/2026`, or "—" for a missing/invalid value. */
export const formatDayTime = (value: string | Date | null | undefined) =>
  formatDateVN(value, { ...DMY, hour: '2-digit', minute: '2-digit' }) || '—'

export const formatDateTimeVN = (value: string | Date | null | undefined) =>
  `${formatDateVN(value)} • ${formatTimeVN(value)}`

/** "3 phút trước" / "3 minutes ago"; falls back to dd/mm after a week. */
export function relativeTime(value: string): string {
  const seconds = Math.floor((Date.now() - new Date(value).getTime()) / 1000)
  if (seconds < 60) return translate(lang(), 'types.justNow')
  const min = Math.floor(seconds / 60)
  if (min < 60) return translate(lang(), 'types.minutesAgo', { min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return translate(lang(), 'types.hoursAgo', { hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return translate(lang(), 'types.daysAgo', { day })
  return formatDateVN(value, { day: '2-digit', month: '2-digit' })
}
