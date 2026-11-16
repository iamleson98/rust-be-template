import type { Lang } from '@/lib/i18n'

const NAMES = {
  vi: {
    long: ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'],
    short: ['CN', 'Th 2', 'Th 3', 'Th 4', 'Th 5', 'Th 6', 'Th 7'],
  },
  en: {
    long: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    short: ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'],
  },
} as const

/**
 * "Thứ Hai, 12/10": the weekday (written out, or two letters when `short`)
 * and the day and month. Plain tables: the date field shows this on the first
 * screen, and a date library would be the biggest thing loaded for it.
 */
export function dayLabel(date: Date, lang: Lang, short = false): string {
  const names = NAMES[lang][short ? 'short' : 'long']
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${names[date.getDay()]}, ${day}/${month}`
}
