'use client'

/**
 * ScheduleTimeline — the trip's timetable rendered in the TripDetailDialog's
 * right rail.
 *
 * Data source order:
 *  1. `detail.schedulePoints` — the REAL `schedule_point` rows (place +
 *     arrival time exactly as the admin stored them). This is the
 *     database truth the customer sees.
 *  2. Fallback — `detail.pickupPoints` ordered by stop order. These have
 *     no times, so stops render without a time chip (never a fake one).
 *
 * The boarding/dropping selectors below the timeline remain separate
 * (see `boarding-points.tsx`) — this component is read-only.
 */

import { useMemo } from 'react'
import { CalendarClock, CircleDot, Flag, MapPin, Navigation } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { formatTimeVN, parseDateSafe } from '@/lib/types'
import type { TripDetailDialogData as TripDetail } from './types'

type Entry = {
  id: string
  name: string
  address: string | null
  /** "HH:MM" display string — null when unknown. */
  time: string | null
  kind: 'first' | 'middle' | 'last'
}

/** Normalize "HH:MM[:SS]" → "HH:MM" display form; null for garbage. */
function displayTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

export function ScheduleTimeline({ detail }: { detail: TripDetail }) {
  const t = useT()

  const entries: Entry[] = useMemo(() => {
    const sp = (detail.schedulePoints ?? []).slice().sort((a, b) => a.stopOrder - b.stopOrder)

    if (sp.length > 0) {
      return sp.map((p, i) => ({
        id: p.id,
        name: p.name,
        address: p.address,
        time: displayTime(p.arrivalTime),
        kind: i === 0 ? 'first' : i === sp.length - 1 ? 'last' : 'middle',
      }))
    }

    // Fallback: route-level pickup points (no times). The departure time
    // anchors the first entry when the schedule provides one.
    const dep = detail.trip.departureTime ? displayTime(detail.trip.departureTime) : null
    const depIso = detail.trip.departureAt ? parseDateSafe(detail.trip.departureAt) : null
    const depDisplay = dep ?? (depIso ? formatTimeVN(depIso) : null)

    const pts = detail.pickupPoints.slice().sort((a, b) => a.stopOrder - b.stopOrder)

    if (pts.length === 0) {
      return [
        {
          id: 'from',
          name: detail.from.name,
          address: null,
          time: depDisplay,
          kind: 'first' as const,
        },
        {
          id: 'to',
          name: detail.to.name,
          address: null,
          time: null,
          kind: 'last' as const,
        },
      ]
    }

    return pts.map((p, i) => ({
      id: p.id,
      name: p.name ?? '—',
      address: p.address,
      // Only the first point carries the departure time; the API sends
      // no per-stop times for route-level points.
      time: i === 0 ? depDisplay : null,
      kind: (i === 0 ? 'first' : i === pts.length - 1 ? 'last' : 'middle') as Entry['kind'],
    }))
  }, [detail])

  const hasAnyTime = entries.some((e) => e.time != null)

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <CalendarClock className="h-4 w-4 text-blue-700" />
          <div className="text-xs font-bold uppercase tracking-wide text-blue-800">
            {t('tripDetail.scheduleTimelineTitle')}
          </div>
        </div>
        {hasAnyTime && (
          <span className="text-[10px] text-muted-foreground">{t('tripDetail.localTimeNote')}</span>
        )}
      </div>

      <ol className="relative space-y-0">
        {entries.map((e, idx) => {
          const isFirst = e.kind === 'first'
          const isLast = e.kind === 'last'
          const showLine = idx < entries.length - 1

          return (
            <li key={e.id} className="relative flex gap-3">
              {/* Left rail: node + connecting line */}
              <div className="flex flex-col items-center shrink-0 w-5">
                {isFirst ? (
                  <span className="relative z-10 grid h-5 w-5 place-items-center rounded-full bg-linear-to-br from-blue-500 to-blue-600 shadow-sm">
                    <Navigation className="h-2.5 w-2.5 text-white" />
                  </span>
                ) : isLast ? (
                  <span className="relative z-10 grid h-5 w-5 place-items-center rounded-full bg-linear-to-br from-rose-500 to-red-600 shadow-sm">
                    <Flag className="h-2.5 w-2.5 text-white" />
                  </span>
                ) : (
                  <span className="relative z-10 grid h-3.5 w-3.5 place-items-center rounded-full border-2 border-blue-400 bg-blue-50">
                    <CircleDot className="h-1.5 w-1.5 text-blue-500" />
                  </span>
                )}
                {showLine && (
                  <span
                    className={`absolute top-5 bottom-0 w-px ${
                      isLast ? '' : 'border-l-2 border-dashed border-slate-300'
                    }`}
                    aria-hidden="true"
                  />
                )}
              </div>

              {/* Body */}
              <div
                className={`flex min-w-0 flex-1 items-baseline justify-between gap-2 pb-3.5 ${
                  idx === entries.length - 1 ? 'pb-1' : ''
                }`}
              >
                <div className="min-w-0">
                  <div
                    className={`truncate text-sm font-semibold ${
                      isFirst ? 'text-blue-800' : isLast ? 'text-rose-700' : 'text-slate-700'
                    }`}
                  >
                    {e.name}
                  </div>
                  {e.address ? (
                    <div className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate">{e.address}</span>
                    </div>
                  ) : null}
                </div>
                <div
                  className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-xs tabular-nums ${
                    e.time
                      ? isLast
                        ? 'bg-rose-50 font-semibold text-rose-700'
                        : 'bg-blue-50 font-semibold text-blue-700'
                      : 'text-muted-foreground'
                  }`}
                >
                  {e.time ?? '—'}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
