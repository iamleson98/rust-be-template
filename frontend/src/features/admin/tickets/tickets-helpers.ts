import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import { enUS, vi } from 'date-fns/locale'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

// ── Constants ────────────────────────────────────────────────

export const PAGE_SIZE = 20

// ── Helpers ──────────────────────────────────────────────────

export function formatVND(n: number | null | undefined): string {
  if (n == null) return '—'
  return new Intl.NumberFormat('vi-VN').format(n) + '₫'
}

export function formatDepartureDate(s: string | null | undefined): string {
  if (!s) return '—'
  try {
    // trip.departureDate is YYYY-MM-DD
    const d = parseISO(s)
    if (!isValid(d)) return s
    const dateLocale = useApp.getState().lang === 'en' ? enUS : vi
    return format(d, 'dd/MM/yyyy', { locale: dateLocale })
  } catch {
    return s
  }
}

export function timeAgo(s: string | null | undefined): string {
  if (!s) return ''
  try {
    const d = parseISO(s)
    if (!isValid(d)) return ''
    const diffMin = differenceInCalendarDays(new Date(), d) * 24 * 60
    const lang = useApp.getState().lang
    if (diffMin < 1) return translate(lang, 'adminTickets.justNow')
    if (diffMin < 60) return translate(lang, 'adminTickets.minutesAgo', { count: Math.floor(diffMin) })
    if (diffMin < 60 * 24) return translate(lang, 'adminTickets.hoursAgo', { count: Math.floor(diffMin / 60) })
    if (diffMin < 60 * 24 * 7) return translate(lang, 'adminTickets.daysAgo', { count: Math.floor(diffMin / 60 / 24) })
    const dateLocale = lang === 'en' ? enUS : vi
    return format(d, 'dd/MM/yyyy', { locale: dateLocale })
  } catch {
    return ''
  }
}
