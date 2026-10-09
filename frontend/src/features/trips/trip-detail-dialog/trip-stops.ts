import type { TripDetail } from '@/api'
import { formatTimeVN } from '@/lib/format'

export type Stop = {
  id: string
  name: string
  address: string | null
  /** "HH:MM", or null when the timetable does not say. */
  time: string | null
  role: 'start' | 'stop' | 'end'
}

/** "HH:MM[:SS]" → "HH:MM"; null for anything else. */
export function hhmm(raw: string | null | undefined): string | null {
  const m = raw?.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/)
  return m ? `${m[1].padStart(2, '0')}:${m[2]}` : null
}

/** Minutes from one "HH:MM" to the next, across midnight; null without both. */
export function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null
  const minutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5))
  return (minutes(to) - minutes(from) + 24 * 60) % (24 * 60) || null
}

const role = (i: number, count: number): Stop['role'] =>
  i === 0 ? 'start' : i === count - 1 ? 'end' : 'stop'

/**
 * The trip's stops in order. The schedule's timetable when the operator set one;
 * otherwise the route's pickup points (or just the two cities), timed only where
 * the trip itself says: departure first, arrival last. `timetable` tells which.
 */
export function tripStops(detail: TripDetail): { stops: Stop[]; timetable: boolean } {
  const timetable = [...detail.schedulePoints].sort((a, b) => a.stopOrder - b.stopOrder)
  if (timetable.length > 0) {
    return {
      timetable: true,
      stops: timetable.map((p, i) => ({
        id: p.id,
        name: p.name,
        address: p.address ?? null,
        time: hhmm(p.arrivalTime),
        role: role(i, timetable.length),
      })),
    }
  }

  const departure =
    hhmm(detail.trip.departureTime) ??
    (detail.trip.departureAt ? formatTimeVN(detail.trip.departureAt) : null)
  const arrival = detail.trip.arrivalAt ? formatTimeVN(detail.trip.arrivalAt) : null
  const points = [...detail.pickupPoints].sort((a, b) => (a.stopOrder ?? 0) - (b.stopOrder ?? 0))
  const places =
    points.length > 1
      ? points.map((p) => ({ id: p.id, name: p.name ?? '—', address: p.address ?? null }))
      : [
          { id: 'from', name: detail.from.name ?? '—', address: null },
          { id: 'to', name: detail.to.name ?? '—', address: null },
        ]
  return {
    timetable: false,
    stops: places.map((place, i) => ({
      ...place,
      time: i === 0 ? departure : i === places.length - 1 ? arrival : null,
      role: role(i, places.length),
    })),
  }
}
