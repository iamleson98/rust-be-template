// Shared types and utilities for the bus booking platform
//
// The label maps below hold I18N KEYS (not display text) — resolve them
// at render time with `t(VEHICLE_TYPE_LABELS[x] ?? x)`. Keeping keys in
// the maps lets every consumer re-localize when the language switches
// while the map shape (and its unknown-key fallbacks) stays unchanged.

export const VEHICLE_TYPE_LABELS: Record<string, string> = {
  limousine: 'types.vehicleLimousine',
  sleeper: 'types.vehicleSleeper',
  semi_sleeper: 'types.vehicleSemiSleeper',
  standard: 'types.vehicleStandard',
  minivan: 'types.vehicleMinivan',
}

export const VEHICLE_TYPE_ICONS: Record<string, string> = {
  limousine: '🚐',
  sleeper: '🛏️',
  semi_sleeper: '💺',
  standard: '🚌',
  minivan: '🚐',
}

export const SEAT_CLASS_LABELS: Record<string, string> = {
  standard: 'types.seatStandard',
  premium: 'types.seatPremium',
  vip: 'types.seatVip',
  bed_lower: 'types.seatBedLower',
  bed_upper: 'types.seatBedUpper',
}

export const SEAT_CLASS_COLORS: Record<string, string> = {
  standard: '#64748b',
  premium: '#2563eb',
  vip: '#7c3aed',
  bed_lower: '#1d4ed8',
  bed_upper: '#3b82f6',
}

export const AMENITY_LABELS: Record<string, string> = {
  window: 'types.amenityWindow',
  legroom: 'types.amenityLegroom',
  recline: 'types.amenityRecline',
  curtain: 'types.amenityCurtain',
  charging: 'types.amenityCharging',
  wifi: 'types.amenityWifi',
  ac: 'types.amenityAc',
  water: 'types.amenityWater',
}

// Locale-aware formatting — reads the CURRENT app language from the
// Zustand store (works outside React too) so numbers, currency, and
// durations follow the VI/EN switch instead of hardcoding Vietnamese.
import { useApp } from '@/lib/store'
import { translate, type Lang } from '@/lib/i18n'

function currentLocale(): 'vi-VN' | 'en-US' {
  return useApp.getState().lang === 'en' ? 'en-US' : 'vi-VN'
}

function currentLang(): Lang {
  return useApp.getState().lang
}

// Format VND currency — "320.000 ₫" (vi) / "₫320,000" (en)
export function formatVND(amount: number): string {
  return new Intl.NumberFormat(currentLocale(), {
    style: 'currency',
    currency: 'VND',
    maximumFractionDigits: 0,
  }).format(amount)
}

// Format number with thousand separator (no currency symbol)
export function formatNum(n: number): string {
  return new Intl.NumberFormat(currentLocale()).format(n)
}

// Format duration in minutes to "Xh Ym" or "X ngày Yh" / "Xd Yh".
// Guards against missing/invalid values (undefined/NaN) — callers pass
// optional API fields here and must never see "NaN giờ".
export function formatDuration(min: number | null | undefined): string {
  if (min == null || !Number.isFinite(min)) return '—'
  if (min < 60) {
    return currentLang() === 'en' ? `${min} min` : `${min} phút`
  }
  const days = Math.floor(min / (24 * 60))
  const hours = Math.floor((min % (24 * 60)) / 60)
  const mins = min % 60
  if (days > 0) {
    const dayWord = currentLang() === 'en' ? 'd' : 'ngày'
    return mins > 0
      ? `${days} ${dayWord} ${hours}h${mins > 0 ? ` ${mins}p` : ''}`
      : `${days} ${dayWord} ${hours}h`
  }
  return mins > 0 ? `${hours}h ${mins}p` : `${hours}h`
}

// Parse a date-ish value defensively → null when empty/unparseable.
// Backend timestamps (departureAt/arrivalAt…) are Option<String> and
// arrival is currently always null (no route-level duration), so every
// formatter must tolerate missing values instead of throwing
// `RangeError: Invalid time value` on `new Date('')`.
//
// Timezone note: the backend emits timezone-less ISO strings
// ("2026-10-02T20:00:00") meaning Vietnam local time. JS parses those
// in the BROWSER's timezone, so on a UTC machine an evening departure
// rolls over to the next day when formatted for Asia/Ho_Chi_Minh.
// Pin naive datetimes to +07:00 to make the interpretation
// deterministic; date-only strings stay as-is (UTC midnight → correct
// date parts in VN).
const NAIVE_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/

export function parseDateSafe(dateStr: string | Date | null | undefined): Date | null {
  if (dateStr == null) return null
  if (dateStr instanceof Date) return Number.isNaN(dateStr.getTime()) ? null : dateStr
  let s = dateStr
  if (NAIVE_DATETIME.test(s)) s += '+07:00'
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

// Format a date string (ISO or yyyy-mm-dd) — locale follows the app
// language (vi-VN default). IMPORTANT: Always use Asia/Ho_Chi_Minh
// timezone to keep date and time parts in sync.
export function formatDateVN(dateStr: string | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string {
  const d = parseDateSafe(dateStr)
  if (!d) return ''
  return new Intl.DateTimeFormat(currentLocale(), {
    timeZone: 'Asia/Ho_Chi_Minh',
    ...(opts ?? { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }),
  }).format(d)
}

export function formatTimeVN(dateStr: string | Date | null | undefined): string {
  const d = parseDateSafe(dateStr)
  if (!d) return '—'
  return new Intl.DateTimeFormat(currentLocale(), { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Ho_Chi_Minh' }).format(d)
}

export function formatDateTimeVN(dateStr: string | Date | null | undefined): string {
  return `${formatDateVN(dateStr)} • ${formatTimeVN(dateStr)}`
}

// Relative time (e.g. "3 phút trước" / "3 minutes ago") — language-
// reactive via the store, so chat lists and dashboards re-localize on
// the VI/EN switch.
export function relativeTime(dateStr: string): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  const diff = Date.now() - d.getTime()
  const lang = currentLang()
  const sec = Math.floor(diff / 1000)
  if (sec < 60) return translate(lang, 'types.justNow')
  const min = Math.floor(sec / 60)
  if (min < 60) return translate(lang, 'types.minutesAgo', { min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return translate(lang, 'types.hoursAgo', { hr })
  const day = Math.floor(hr / 24)
  if (day < 7) return translate(lang, 'types.daysAgo', { day })
  return formatDateVN(dateStr, { day: '2-digit', month: '2-digit' })
}

// Vietnamese diacritic-insensitive search normalization
export function noTones(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .trim()
}

export function normalizePhone(phone: string): string {
  const p = phone.replace(/\s/g, '')
  if (p.startsWith('0')) return '+84' + p.slice(1)
  if (p.startsWith('84')) return '+' + p
  return p
}
