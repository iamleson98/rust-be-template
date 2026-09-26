/**
 * Pure helpers for the /admin/brands tree table (brands → routes →
 * schedules). Everything here is side-effect free so it can be unit
 * tested in isolation — see `__tests__/brand-tree-helpers.test.ts`.
 */

import { DAY_LABELS, VEHICLE_LABELS } from '@/features/admin/types'
import { translate } from '@/lib/i18n'
import { useApp } from '@/lib/store'

/** Resolve a dictionary key in the CURRENT app language (vi default).
 *  Called at render/compute time so VI/EN switches re-localize. */
const L = (key: string, params?: Record<string, string | number>) =>
  translate(useApp.getState().lang, key, params)
import type {
  AdminBrandOut,
  AdminRouteOut,
  AdminScheduleOut,
} from '@/lib/api/types.gen'

/** Sort-key labels — I18N KEYS (resolved by the consumer's `t`). */
export type ScheduleSortKey = 'departureTime' | 'priceAdult' | 'effectiveFrom'

export type ScheduleSortDir = 'asc' | 'desc'

export type ScheduleSort = {
  key: ScheduleSortKey
  dir: ScheduleSortDir
}

export const SCHEDULE_SORT_LABELS: Record<ScheduleSortKey, string> = {
  departureTime: 'brands.sortDeparture',
  priceAdult: 'brands.sortPrice',
  effectiveFrom: 'brands.sortEffective',
}

/** Case/diacritic-insensitive needle for Vietnamese brand searches. */
function fold(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/đ/g, 'd')
    .trim()
}

/** True when the brand matches the free-text search box (name, slug or
 *  contact phone — same fields the legacy 3-panel page searched). */
export function matchesBrandSearch(
  brand: Pick<AdminBrandOut, 'name' | 'slug' | 'contactPhone'>,
  q: string,
): boolean {
  const needle = fold(q)
  if (!needle) return true
  return (
    fold(brand.name).includes(needle) ||
    fold(brand.slug).includes(needle) ||
    (brand.contactPhone ?? '').replace(/\s/g, '').includes(needle.replace(/\s/g, ''))
  )
}

/** Smart filter — a brand is relevant when at least one of its routes
 *  matches the selected start AND end points. `matchingBrandIds` comes
 *  from the server-side filtered route list. */
export function brandMatchesRouteFilter(
  brand: Pick<AdminBrandOut, 'id'>,
  matchingBrandIds: Set<string>,
): boolean {
  return matchingBrandIds.has(brand.id)
}

/** Sort a route group's schedule rows. Sorting is stable (equal keys
 *  keep their server order) and scoped to the group — brand and route
 *  rows never interleave with schedule rows. */
export function sortSchedules(
  schedules: AdminScheduleOut[],
  sort: ScheduleSort,
): AdminScheduleOut[] {
  const sorted = [...schedules]
  sorted.sort((a, b) => {
    const cmp = compareBySortKey(a, b, sort.key)
    return sort.dir === 'asc' ? cmp : -cmp
  })
  return sorted
}

function compareBySortKey(
  a: AdminScheduleOut,
  b: AdminScheduleOut,
  key: ScheduleSortKey,
): number {
  switch (key) {
    case 'departureTime':
      return (a.departureTime ?? '').localeCompare(b.departureTime ?? '')
    case 'priceAdult':
      return (a.basePriceAdult ?? 0) - (b.basePriceAdult ?? 0)
    case 'effectiveFrom':
      return (a.effectiveFrom ?? '').localeCompare(b.effectiveFrom ?? '')
  }
}

/** Cycle the sort: none → key asc → key desc → (keep desc). */
export function nextScheduleSort(
  current: ScheduleSort | null,
  key: ScheduleSortKey,
): ScheduleSort {
  if (!current || current.key !== key) {
    return { key, dir: 'asc' }
  }
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' }
}

/** Pretty-prints a 7-char `daysOfWeek` bitmask (`1111111` = daily). */
export function daysLabel(days: string | null | undefined): string {
  const d = days ?? ''
  if (!d || d === '1111111') return L('map.daily')
  if (d === '0000000') return L('adminShared.daysInactive')
  if (d === '0000011') return L('adminSchedules.weekend')
  if (d === '1111100') return L('adminSchedules.weekdays')
  const parts: string[] = []
  for (let i = 0; i < 7; i++) if (d[i] === '1') parts.push(L(DAY_LABELS[i]))
  return parts.join(', ')
}

/** Compact day chips for the schedule row (T2 T3 … CN). */
export function dayChips(days: string | null | undefined): { label: string; active: boolean }[] {
  const d = days ?? '1111111'
  // Resolve the day keys at call time — the tree row re-renders on the
  // VI/EN switch, which re-invokes this and re-localizes the chips.
  return DAY_LABELS.map((key, i) => ({ label: L(key), active: d[i] === '1' }))
}

/** First → last stop summary for the schedule row's point sequence:
 *  `Bến xe Miền Đông → Bến xe Nước Ngầm` (+N for midway stops). */
export function schedulePointsSummary(schedule: AdminScheduleOut): string {
  const pts = schedule.points ?? []
  if (pts.length < 2) return '—'
  const first = pts[0]?.address?.name ?? '?'
  const last = pts[pts.length - 1]?.address?.name ?? '?'
  const middles = pts.length - 2
  return middles > 0 ? `${first} → ${last} (+${middles})` : `${first} → ${last}`
}

/** Arrival times of the first/last stops, for the row's point column. */
export function scheduleStopTimes(schedule: AdminScheduleOut): string {
  const pts = schedule.points ?? []
  if (pts.length < 2) return ''
  const first = pts[0]?.arrivalTime
  const last = pts[pts.length - 1]?.arrivalTime
  if (first && last) return `${first} → ${last}`
  if (first) return `${first} → ?`
  if (last) return `? → ${last}`
  return ''
}

/** Display label for a schedule's vehicle class: the explicit
 *  vehicle_type row wins, the bus-layout's legacy code is the
 *  fallback. */
export function vehicleLabelFor(schedule: AdminScheduleOut): string {
  if (schedule.vehicleType?.label) return schedule.vehicleType.label
  return '—'
}

/** `start → end` label with city-name resolution via the embedded
 *  previews (falls back to the raw slugs). */
export function routeDirection(route: AdminRouteOut): string {
  const from = route.startLocation?.name ?? route.startLocationId
  const to = route.endLocation?.name ?? route.endLocationId
  return `${from} → ${to}`
}

/** Effective window label (`từ 01/10 → 01/12`), tolerant of missing
 *  bounds. */
export function effectiveWindow(schedule: AdminScheduleOut): string {
  const from = schedule.effectiveFrom
  const to = schedule.effectiveTo
  if (from && to) return `${from} → ${to}`
  if (from) return L('adminShared.fromDate', { date: from })
  if (to) return L('adminShared.untilDate', { date: to })
  return '—'
}

/** Legacy vehicle-code label lookup (used by the bus-layout form's
 *  vehicle-type preset picker). */
export function vehicleCodeLabel(code: string | null | undefined): string {
  if (!code) return '—'
  const key = VEHICLE_LABELS[code]
  return key ? L(key) : code
}
