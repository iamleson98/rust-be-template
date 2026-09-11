import { format, parseISO, isValid, differenceInCalendarDays } from 'date-fns'
import { vi } from 'date-fns/locale'

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
    return format(d, 'dd/MM/yyyy', { locale: vi })
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
    if (diffMin < 1) return 'vừa xong'
    if (diffMin < 60) return `${Math.floor(diffMin)} phút trước`
    if (diffMin < 60 * 24) return `${Math.floor(diffMin / 60)} giờ trước`
    if (diffMin < 60 * 24 * 7) return `${Math.floor(diffMin / 60 / 24)} ngày trước`
    return format(d, 'dd/MM/yyyy', { locale: vi })
  } catch {
    return ''
  }
}
