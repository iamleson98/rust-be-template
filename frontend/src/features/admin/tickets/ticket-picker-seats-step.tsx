'use client'

import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Armchair, MapPin } from 'lucide-react'
import type { TripResult, TripDetail } from '@/lib/api/types.gen'
import type { Seat } from './chat-ticket-picker-types'

// ── SeatsStep ───────────────────────────────────────────────

export function SeatsStep({
  trip,
  selectedTrip,
  selectedSeats,
  onToggleSeat,
  boardingPoints,
  droppingPoints,
  boardingPointId,
  droppingPointId,
  setBoardingPointId,
  setDroppingPointId,
  totalPrice,
}: {
  trip: TripDetail
  selectedTrip: TripResult
  selectedSeats: Seat[]
  onToggleSeat: (s: Seat) => void
  boardingPoints: TripDetail['pickupPoints']
  droppingPoints: TripDetail['pickupPoints']
  boardingPointId: string
  droppingPointId: string
  setBoardingPointId: (id: string) => void
  setDroppingPointId: (id: string) => void
  totalPrice: number
}) {
  const selectedIds = new Set(selectedSeats.map((s) => s.id))
  const decks = trip.seatMap?.decks ?? []
  return (
    <div className="space-y-3">
      {/* Trip summary */}
      <div className="rounded-lg bg-linear-to-r from-blue-50 to-emerald-50 p-2.5 text-xs">
        <div className="flex items-center justify-between">
          <div>
            <div className="font-semibold">
              {selectedTrip.fromName} → {selectedTrip.toName}
            </div>
            <div className="text-muted-foreground">
              {selectedTrip.brandName} · {selectedTrip.departureTime} ·{' '}
              {selectedTrip.vehicleTypeLabel}
            </div>
          </div>
          <Badge variant="outline" className="text-[10px]">
            {selectedTrip.availableSeats} ghế trống
          </Badge>
        </div>
      </div>

      {/* Seat map */}
      <div className="rounded-lg border p-3 bg-slate-50/50">
        <div className="text-xs font-semibold mb-2 flex items-center gap-1.5">
          <Armchair className="h-3.5 w-3.5" />
          Sơ đồ ghế
        </div>
        <div className="space-y-3">
          {decks.map((deck) => (
            <div key={deck.deck}>
              {decks.length > 1 && (
                <div className="text-[10px] text-muted-foreground uppercase mb-1">
                  Tầng {deck.deck}
                </div>
              )}
              <div className="space-y-1">
                {deck.rows.map((row) => (
                  <div key={row.row} className="flex items-center gap-1.5 justify-center">
                    <span className="text-[9px] text-muted-foreground w-3">{row.row}</span>
                    {row.seats.map((seat) => {
                      const isAvailable = seat.status === 'available'
                      const isSelected = selectedIds.has(seat.id)
                      return (
                        <button
                          key={seat.id}
                          disabled={!isAvailable}
                          onClick={() =>
                            onToggleSeat({
                              id: seat.id,
                              code: seat.code,
                              row: seat.row,
                              col: seat.col,
                              deck: seat.deck,
                              seatClass: seat.seatClass ?? '',
                              priceMultiplier: 1,
                              status: seat.status,
                              finalPrice: seat.finalPrice,
                            })
                          }
                          className={`h-7 w-7 rounded text-[9px] font-mono font-bold transition-all ${!isAvailable
                            ? 'bg-slate-200 text-slate-400 cursor-not-allowed'
                            : isSelected
                              ? 'bg-blue-600 text-white ring-2 ring-blue-300'
                              : seat.seatClass === 'vip' || seat.seatClass === 'bed_lower'
                                ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                                : 'bg-white border text-slate-700 hover:border-blue-400 hover:bg-blue-50'
                            }`}
                          title={`${seat.code} · ${seat.seatClass} · ${new Intl.NumberFormat('vi-VN').format(seat.finalPrice)}₫`}
                        >
                          {seat.code}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        {/* Legend */}
        <div className="flex flex-wrap gap-2 mt-2 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-white border" /> Còn trống
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-amber-100" /> VIP
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-blue-600" /> Đã chọn
          </span>
          <span className="flex items-center gap-1">
            <span className="inline-block h-3 w-3 rounded bg-slate-200" /> Đã có người đặt
          </span>
        </div>
      </div>

      {/* Boarding / dropping points */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Điểm đón
          </Label>
          <Select value={boardingPointId} onValueChange={setBoardingPointId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Chọn điểm đón" />
            </SelectTrigger>
            <SelectContent>
              {boardingPoints.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
            <MapPin className="h-3 w-3" /> Điểm trả
          </Label>
          <Select value={droppingPointId} onValueChange={setDroppingPointId}>
            <SelectTrigger className="h-9">
              <SelectValue placeholder="Chọn điểm trả" />
            </SelectTrigger>
            <SelectContent>
              {droppingPoints.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name ?? '—'}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {selectedSeats.length > 0 && (
        <div className="rounded-lg bg-blue-50/50 border border-blue-200 p-2.5">
          <div className="text-xs font-semibold text-blue-700 mb-1">
            Đã chọn {selectedSeats.length} ghế
          </div>
          <div className="flex flex-wrap gap-1">
            {selectedSeats.map((s) => (
              <Badge key={s.id} variant="outline" className="text-[10px] font-mono bg-white">
                {s.code} · {new Intl.NumberFormat('vi-VN').format(s.finalPrice)}₫
              </Badge>
            ))}
          </div>
          <div className="text-xs mt-1.5 font-semibold text-right text-blue-700">
            Tổng: {new Intl.NumberFormat('vi-VN').format(totalPrice)}₫
          </div>
        </div>
      )}
    </div>
  )
}
