'use client'

/**
 * BoardingPoints — pickup/dropoff point selection list (right rail of
 * the TripDetailDialog). Renders the same list of points twice: once
 * for boarding selection (radio-style) and once for dropping selection.
 *
 * Also shows the selected seats list with per-seat price + class label.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 493-603). Pure refactor — same DOM, same handlers.
 */

import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { MapPin, Flag } from 'lucide-react'
import {
  formatDuration,
  SEAT_CLASS_LABELS,
} from '@/lib/types'
import { formatCurrency, type Currency } from '@/lib/currency'
import type { SeatInv } from '@/components/trips/seat-map'
import type { TripDetailDialogData as TripDetail } from './types'

export function BoardingPoints({
  detail,
  boardingPoint,
  droppingPoint,
  onSetBoardingPoint,
  onSetDroppingPoint,
  selectedSeatDetails,
  currency,
}: {
  detail: TripDetail
  boardingPoint: string
  droppingPoint: string
  onSetBoardingPoint: (id: string) => void
  onSetDroppingPoint: (id: string) => void
  selectedSeatDetails: SeatInv[]
  currency: Currency
}) {
  return (
    <div className="bg-slate-50 flex flex-col min-h-0 hidden md:flex">
      <ScrollArea className="flex-1 max-h-[calc(92vh-220px)]">
        <div className="p-4 md:p-5 space-y-5">
          {/* Pickup points */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <MapPin className="h-3.5 w-3.5 text-blue-700" />
              <div className="text-xs font-bold uppercase tracking-wide text-blue-800">
                Điểm đón
              </div>
            </div>
            <div className="space-y-2">
              {detail.pickupPoints.map((p) => {
                const selected = boardingPoint === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => onSetBoardingPoint(p.id)}
                    className={`group w-full text-left rounded-xl border px-3.5 py-2.5 text-sm transition-all ${
                      selected
                        ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-500/20 '
                        : 'border-slate-200 bg-white hover:border-blue-300 hover:bg-blue-50/40 '
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 transition-colors ${selected ? 'bg-blue-600' : 'bg-slate-300 group-hover:bg-blue-400'}`} />
                        <div className="min-w-0">
                          <div className={`font-medium truncate ${selected ? 'text-blue-900' : 'text-slate-800'}`}>{p.name}</div>
                          {p.address && (
                            <div className="text-xs text-muted-foreground truncate mt-0.5">{p.address}</div>
                          )}
                        </div>
                      </div>
                      <div className={`text-xs font-medium shrink-0 rounded-md px-1.5 py-0.5 ${selected ? 'bg-blue-100 text-blue-700' : 'text-muted-foreground'}`}>
                        +{formatDuration(p.etaOffsetMin)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Dropoff points */}
          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Flag className="h-3.5 w-3.5 text-rose-600" />
              <div className="text-xs font-bold uppercase tracking-wide text-rose-700">
                Điểm trả
              </div>
            </div>
            <div className="space-y-2">
              {detail.pickupPoints.map((p) => {
                const selected = droppingPoint === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => onSetDroppingPoint(p.id)}
                    className={`group w-full text-left rounded-xl border px-3.5 py-2.5 text-sm transition-all ${
                      selected
                        ? 'border-rose-400 bg-rose-50 ring-2 ring-rose-400/20 '
                        : 'border-slate-200 bg-white hover:border-rose-300 hover:bg-rose-50/40 '
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2.5">
                      <div className="min-w-0 flex items-center gap-2">
                        <span className={`h-2 w-2 rounded-full shrink-0 transition-colors ${selected ? 'bg-rose-500' : 'bg-slate-300 group-hover:bg-rose-400'}`} />
                        <div className="min-w-0">
                          <div className={`font-medium truncate ${selected ? 'text-rose-900' : 'text-slate-800'}`}>{p.name}</div>
                        </div>
                      </div>
                      <div className={`text-xs font-medium shrink-0 rounded-md px-1.5 py-0.5 ${selected ? 'bg-rose-100 text-rose-700' : 'text-muted-foreground'}`}>
                        +{formatDuration(p.etaOffsetMin)}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>

          {/* Selected seats */}
          {selectedSeatDetails.length > 0 && (
            <div>
              <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">
                Ghế đã chọn
              </div>
              <div className="space-y-1.5">
                {selectedSeatDetails.map((s) => (
                  <div
                    key={s.id}
                    className="flex items-center justify-between rounded-lg bg-white border px-3 py-2 text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="font-mono">
                        {s.code}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        {SEAT_CLASS_LABELS[s.seatClass]}
                      </span>
                    </div>
                    <div className="font-semibold text-blue-800">{formatCurrency(s.finalPrice, currency)}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}
