'use client'

/**
 * RouteTimeline — vertical timeline of the trip's stops.
 *
 * Rendered inside the "Lộ trình" tab of the TripDetailDialog.
 *
 * Two data sources, in order of preference:
 *
 *  1. `schedulePoints` — the REAL per-stop timetable from the
 *     `schedule_point` table (arrival times the admin configured).
 *     This is the source of truth: place + arrive time, exactly as
 *     stored in the database.
 *  2. Fallback — route-level `pickupPoints` ordered by `stopOrder`.
 *     These carry no times, so every stop after the first renders
 *     an honest "—" (never a fabricated ETA).
 */

import { useMemo } from 'react'
import { Clock, Timer, ArrowDown, Navigation } from 'lucide-react'
import { formatDuration, formatTimeVN, parseDateSafe } from '@/lib/types'
import { useT } from '@/lib/i18n'

type SchedulePointItem = {
  id: string
  stopOrder: number
  kind: string
  arrivalTime: string | null
  name: string
  address: string | null
}

type RouteTimelinePoint = {
  id: string
  name: string | null
  stopOrder: number
  /** Optional per the API — the backend currently emits no ETA
   *  offset, so derived stop times/durations degrade gracefully. */
  etaOffsetMin?: number
  kind?: string | null
}

/** Combine a yyyy-mm-dd date + "HH:MM" time (or an ISO string) into a
 *  valid Date — null when either part is missing/unparseable. Time-only
 *  strings like "08:00" are NOT valid Dates on their own. Parsed via
 *  parseDateSafe so naive datetimes are pinned to Vietnam time. */
function resolveDepartureDate(
  departureDate: string | null | undefined,
  departureTime: string | null | undefined,
): Date | null {
  if (!departureDate) return null
  const day = departureDate.slice(0, 10)
  if (departureTime) {
    const d = parseDateSafe(
      `${day}T${departureTime.length === 5 ? `${departureTime}:00` : departureTime}`,
    )
    if (d) return d
  }
  return parseDateSafe(departureDate)
}

/** Normalize a "HH:MM[:SS]" arrival string for display — trimmed to
 *  HH:MM. Returns null for missing/garbage values (never "Invalid"). */
function displayTime(raw: string | null | undefined): string | null {
  if (!raw) return null
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/)
  if (!m) return null
  return `${m[1].padStart(2, '0')}:${m[2]}`
}

export function RouteTimeline({
  departureDate,
  departureTime,
  arrivalTime,
  fromName,
  toName,
  pickupPoints,
  schedulePoints,
}: {
  /** Trip's yyyy-mm-dd date — the anchor every stop time is derived from. */
  departureDate: string | null
  /** "HH:MM" schedule departure time (nullable per the API). */
  departureTime: string | null
  /** ISO arrival timestamp — currently always null (no route duration). */
  arrivalTime: string | null
  fromName: string
  toName: string
  pickupPoints: RouteTimelinePoint[]
  /** The real timetable (schedule_point rows). Preferred when present. */
  schedulePoints?: SchedulePointItem[]
}) {
  const t = useT()

  // ── Preferred source: the schedule's own timetable ──────────────
  const timetable = useMemo(() => {
    const points = (schedulePoints ?? []).slice().sort((a, b) => a.stopOrder - b.stopOrder)
    if (points.length === 0) return null
    return points.map((p) => ({
      id: p.id,
      name: p.name,
      address: p.address,
      time: displayTime(p.arrivalTime),
      kind: p.kind,
    }))
  }, [schedulePoints])

  // ── Fallback source: route pickup points, position-derived ──────
  const timelineItems = useMemo(() => {
    const depDate = resolveDepartureDate(departureDate, departureTime)
    const items: {
      id: string
      name: string
      time: Date | null
      offsetMin: number
      type: 'start' | 'pickup' | 'drop' | 'end'
    }[] = []

    // Starting point
    items.push({
      id: 'start',
      name: fromName,
      time: depDate,
      offsetMin: 0,
      type: 'start',
    })

    // Pickup and drop points (middle stops), ordered by stop_order
    const midPoints = pickupPoints
      .filter(
        (p) =>
          p.stopOrder > 0 &&
          p.stopOrder <
            (pickupPoints.length > 0 ? pickupPoints[pickupPoints.length - 1].stopOrder : 0),
      )
      .sort((a, b) => a.stopOrder - b.stopOrder)

    for (const p of midPoints) {
      // No ETA offset (backend doesn't provide one on pickup points) →
      // time stays null and renders as "—" instead of Invalid-Date/NaN.
      const tt =
        depDate && p.etaOffsetMin != null
          ? new Date(depDate.getTime() + p.etaOffsetMin * 60_000)
          : null
      items.push({
        id: p.id,
        name: p.name ?? '—',
        time: tt,
        offsetMin: p.etaOffsetMin ?? 0,
        type: p.kind === 'drop' ? 'drop' : 'pickup',
      })
    }

    // Ending point — anchored at the trip's arrival time when present
    // (otherwise the departure; no fabricated "+30 min" guess).
    let endDate: Date | null = null
    if (arrivalTime) {
      endDate = parseDateSafe(arrivalTime)
    }
    if (!endDate) {
      endDate = depDate
    }
    items.push({
      id: 'end',
      name: toName,
      time: endDate,
      offsetMin: 0,
      type: 'end',
    })

    return items
  }, [departureDate, departureTime, arrivalTime, fromName, toName, pickupPoints])

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Timer className="h-4 w-4 text-blue-700" />
        <h3 className="text-sm font-semibold">{t('tripDetail.routeTimelineTitle')}</h3>
      </div>

      {timetable ? (
        <div className="relative pl-7">
          {/* Vertical connecting line */}
          {timetable.length > 1 && (
            <div
              className="absolute left-3 top-4 bottom-4 w-px border-l-2 border-dashed border-slate-300"
              aria-hidden="true"
            />
          )}

          {timetable.map((item, idx) => {
            const isFirst = idx === 0
            const isLast = idx === timetable.length - 1
            const next = idx < timetable.length - 1 ? timetable[idx + 1] : null
            const nextTime = next ? displayTime(next.time) : null
            const thisTime = displayTime(item.time)
            // Segment duration — only when both stops have real times.
            const segMin = (() => {
              if (!thisTime || !nextTime) return 0
              const [h1, m1] = thisTime.split(':').map(Number)
              const [h2, m2] = nextTime.split(':').map(Number)
              const d = h2 * 60 + m2 - (h1 * 60 + m1)
              return d > 0 ? d : 0
            })()

            return (
              <div key={item.id} className="relative pb-3">
                <div className="flex items-start gap-3">
                  {/* Dot / Circle on the timeline */}
                  <div className="absolute -left-7 top-0 flex items-center justify-center w-6 h-6 z-10">
                    {isFirst || isLast ? (
                      <div
                        className={`h-5 w-5 rounded-full flex items-center justify-center ${
                          isFirst
                            ? 'bg-linear-to-br from-blue-500 to-blue-600'
                            : 'bg-linear-to-br from-rose-500 to-red-600'
                        }`}
                      >
                        <div className="h-2 w-2 rounded-full bg-white" />
                      </div>
                    ) : (
                      <div
                        className={`h-3 w-3 rounded-full border-2 ${
                          item.kind === 'drop'
                            ? 'bg-amber-100 border-amber-500'
                            : 'bg-blue-100 border-blue-500'
                        }`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`text-sm font-semibold truncate block ${
                            isFirst
                              ? 'text-blue-800'
                              : isLast
                                ? 'text-rose-700'
                                : item.kind === 'drop'
                                  ? 'text-amber-700'
                                  : 'text-blue-800'
                          }`}
                        >
                          {item.name}
                        </span>
                        {(isFirst || isLast) && (
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wider ${
                              isFirst ? 'text-blue-600' : 'text-rose-500'
                            }`}
                          >
                            {isFirst ? t('search.from') : t('search.to')}
                          </span>
                        )}
                        {!isFirst && !isLast && (
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wider ${
                              item.kind === 'drop' ? 'text-amber-500' : 'text-blue-600'
                            }`}
                          >
                            {item.kind === 'drop'
                              ? t('tripDetail.dropoffLabel')
                              : t('tripDetail.pickupLabel')}
                          </span>
                        )}
                        {item.address && (
                          <span className="block text-[11px] text-muted-foreground truncate mt-0.5">
                            {item.address}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3" />
                        {displayTime(item.time) ?? '—'}
                      </div>
                    </div>

                    {/* Duration to next segment — only when both stops
                        carry real times. */}
                    {next && segMin > 0 && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <div
                          className={`h-px flex-1 ${
                            item.kind === 'drop'
                              ? 'bg-amber-200'
                              : isFirst
                                ? 'bg-blue-200'
                                : 'bg-slate-200'
                          }`}
                        />
                        <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                          <ArrowDown className="h-2.5 w-2.5" />
                          {formatDuration(segMin)}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="relative pl-6">
          {/* Vertical dashed connecting line */}
          {timelineItems.length > 1 && (
            <div
              className="absolute left-2.75 top-4 bottom-4 w-px border-l-2 border-dashed border-slate-300"
              aria-hidden="true"
            />
          )}

          {timelineItems.map((item) => {
            const isFirst = item.type === 'start'
            const isLast = item.type === 'end'
            const isPickup = item.type === 'pickup'
            const isDrop = item.type === 'drop'
            const isMid = isPickup || isDrop

            return (
              <div key={item.id} className="relative pb-2">
                <div className="flex items-start gap-3">
                  {/* Dot / Circle on the timeline */}
                  <div className="absolute -left-6 top-0 flex items-center justify-center w-6 h-6 z-10">
                    {isFirst || isLast ? (
                      <div
                        className={`h-5 w-5 rounded-full flex items-center justify-center ${
                          isFirst
                            ? 'bg-linear-to-br from-blue-500 to-blue-600'
                            : 'bg-linear-to-br from-rose-500 to-red-600'
                        }`}
                      >
                        <div className="h-2 w-2 rounded-full bg-white" />
                      </div>
                    ) : (
                      <div
                        className={`h-3 w-3 rounded-full border-2 ${
                          isPickup ? 'bg-blue-100 border-blue-500' : 'bg-amber-100 border-amber-500'
                        }`}
                      />
                    )}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0 pt-0.5">
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <span
                          className={`text-sm font-semibold truncate block ${
                            isFirst
                              ? 'text-blue-800'
                              : isLast
                                ? 'text-rose-700'
                                : isPickup
                                  ? 'text-blue-800'
                                  : 'text-amber-700'
                          }`}
                        >
                          {item.name}
                        </span>
                        {(isFirst || isLast) && (
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wider ${
                              isFirst ? 'text-blue-600' : 'text-rose-500'
                            }`}
                          >
                            {isFirst ? t('search.from') : t('search.to')}
                          </span>
                        )}
                        {isMid && (
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wider ${
                              isPickup ? 'text-blue-600' : 'text-amber-500'
                            }`}
                          >
                            {isPickup ? t('tripDetail.pickupLabel') : t('tripDetail.dropoffLabel')}
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1 font-mono">
                        <Clock className="h-3 w-3" />
                        {item.time ? formatTimeVN(item.time) : '—'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )
          })}

          {/* Fallback notice — no configured timetable, so stop times
              are unknown (only the departure is real). */}
          <div className="mt-3 flex items-start gap-2 rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-[11px] text-muted-foreground">
            <Navigation className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span>{t('tripDetail.timetableFallbackNotice')}</span>
          </div>
        </div>
      )}
    </div>
  )
}
