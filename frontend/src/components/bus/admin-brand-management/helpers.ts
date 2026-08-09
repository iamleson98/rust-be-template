/**
 * Pure helper functions for the AdminBrandManagement module.
 *
 * Extracted verbatim from the original `admin-brand-management.tsx`
 * (lines 186-218). Kept as pure functions so they can be unit-tested
 * in isolation and tree-shaken when not used.
 */

import { DAY_LABELS } from './types'

/** Vietnamese-friendly slugify: strips tones, lowercases, joins words with `-`. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Formats a duration in minutes as `HhMM` (e.g. `2h15`, `1h00`, `0h45`). */
export function formatDuration(min: number): string {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = min % 60
  return m ? `${h}h${m.toString().padStart(2, '0')}` : `${h}h`
}

/** Pretty-prints a 7-char `daysOfWeek` bitmask (`1111111` = daily). */
export function daysLabel(days: string): string {
  if (!days || days === '1111111') return 'Hàng ngày'
  if (days === '0000000') return 'Không hoạt động'
  // Weekend = T7,CN
  if (days === '0000011') return 'Cuối tuần'
  // Weekdays
  if (days === '1111100') return 'Ngày thường'
  const parts: string[] = []
  for (let i = 0; i < 7; i++) if (days[i] === '1') parts.push(DAY_LABELS[i])
  return parts.join(', ')
}
