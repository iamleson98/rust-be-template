'use client'

/**
 * RouteTimeline — vertical timeline of pickup/dropoff stops for a trip.
 *
 * Rendered inside the "Lộ trình" tab of the TripDetailDialog.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 1509-1702). Pure refactor.
 */

import { useMemo } from 'react'
import { Clock, Timer, ArrowDown } from 'lucide-react'
import { formatDuration, formatTimeVN, parseDateSafe } from '@/lib/types'
import { useT } from '@/lib/i18n'

type RouteTimelinePoint = {
  id: string
  name: string
  stopOrder: number
  etaOffsetMin: number
  pickupType: string
}

/** Combine a yyyy-mm-dd date + "HH:MM" time (or an ISO string) into a
 *  valid Date — null when either part is missing/unparseable. Time-only
 *  strings like "08:00" are NOT valid Dates on their own. Parsed via
 *  parseDateSafe so naive datetimes are pinned to Vietnam time. */
function resolveDepartureDate(departureDate: string | null | undefined, departureTime: string | null | undefined): Date | null {
  if (!departureDate) return null
  const day = departureDate.slice(0, 10)
  if (departureTime) {
    const d = parseDateSafe(`${day}T${departureTime.length === 5 ? `${departureTime}:00` : departureTime}`)
    if (d) return d
  }
  return parseDateSafe(departureDate)
}

export function RouteTimeline({
  departureDate,
  departureTime,
  arrivalTime,
  fromName,
  toName,
  pickupPoints,
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
}) {
  const t = useT()
  // Compute time for each stop: departure + etaOffsetMin
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

    // Pickup and drop points (middle stops)
    // pickupType: "pickup" or "dropoff" or "both"
    const midPoints = pickupPoints
      .filter((p) => p.stopOrder > 0 && p.stopOrder < (pickupPoints.length > 0 ? pickupPoints[pickupPoints.length - 1].stopOrder : 0))
      .sort((a, b) => a.stopOrder - b.stopOrder)

    for (const p of midPoints) {
      const t = depDate ? new Date(depDate.getTime() + p.etaOffsetMin * 60_000) : null
      items.push({
        id: p.id,
        name: p.name,
        time: t,
        offsetMin: p.etaOffsetMin,
        type: p.pickupType === 'dropoff' ? 'drop' : 'pickup',
      })
    }

    // Ending point — no route-level duration anymore, so we anchor it
    // at the trip's arrival time when present (otherwise fall back to
    // the last pickup's time + offset, else just the departure).
    let endDate: Date | null = null
    if (arrivalTime) {
      endDate = parseDateSafe(arrivalTime)
    }
    if (!endDate) {
      const last = items[items.length - 1]
      if (last?.time) {
        endDate = new Date(last.time.getTime() + 30 * 60_000)
      } else {
        endDate = depDate
      }
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

      <div className="relative pl-6">
        {/* Vertical dashed connecting line */}
        {timelineItems.length > 1 && (
          <div
            className="absolute left-2.75 top-4 bottom-4 w-px border-l-2 border-dashed border-slate-300"
            aria-hidden="true"
          />
        )}

        {timelineItems.map((item, idx) => {
          const isFirst = item.type === 'start'
          const isLast = item.type === 'end'
          const isPickup = item.type === 'pickup'
          const isDrop = item.type === 'drop'
          const isMid = isPickup || isDrop
          const nextItem = idx < timelineItems.length - 1 ? timelineItems[idx + 1] : null

          return (
            <div
              key={item.id}
              className="relative pb-2"
            >
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
                        isPickup
                          ? 'bg-blue-100 border-blue-500'
                          : 'bg-amber-100 border-amber-500'
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
                          isFirst ? 'text-blue-800' : isLast ? 'text-rose-700' : isPickup ? 'text-blue-800' : 'text-amber-700'
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

                  {/* Duration to next segment */}
                  {nextItem && (
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <div
                        className={`h-px flex-1 ${
                          isPickup ? 'bg-blue-200' : isDrop ? 'bg-amber-200' : isFirst ? 'bg-blue-200' : 'bg-slate-200'
                        }`}
                      />
                      <span className="text-[10px] text-muted-foreground shrink-0 flex items-center gap-0.5">
                        <ArrowDown className="h-2.5 w-2.5" />
                        {formatDuration(nextItem.offsetMin - item.offsetMin)}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
