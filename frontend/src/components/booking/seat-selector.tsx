'use client'

/**
 * SeatSelector — the mini seat-preview shown in the BookingDialog's
 * passenger step.
 *
 * Extracted from the original `booking-dialog.tsx`. Renders the selected
 * seats as a grid of color-coded pills — each pill shows the seat code
 * + the index of the passenger it's assigned to (or "chưa gắn" when
 * unassigned). The colors come from `PASSENGER_TYPE_META` keyed by
 * each passenger's auto-detected `PassengerType`.
 */

import { Armchair } from 'lucide-react'
import {
  PASSENGER_TYPE_META,
  getPassengerType,
  type PassengerFormValue,
  type SelectedSeat,
} from './booking-form'

export function SeatSelector({
  selectedSeats,
  passengers,
}: {
  selectedSeats: SelectedSeat[]
  passengers: PassengerFormValue[]
}) {
  if (selectedSeats.length === 0) return null

  return (
    <div className="rounded-lg border bg-slate-50 p-3">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2 flex items-center gap-1.5">
        <Armchair className="h-3 w-3" />
        Sơ đồ ghép ghế
      </div>
      <div className="flex flex-wrap gap-2">
        {selectedSeats.map((s) => {
          const passengerIdx = passengers.findIndex((p) => p.seatId === s.id)
          const isAssigned = passengerIdx >= 0
          const passenger = isAssigned ? passengers[passengerIdx] : null
          const typeMeta = passenger
            ? PASSENGER_TYPE_META[getPassengerType(passenger.age)]
            : null
          return (
            <div
              key={s.id}
              className={`relative rounded-lg border-2 px-2.5 py-1.5 min-w-16 text-center transition-all ${
                isAssigned && typeMeta
                  ? `${typeMeta.border} bg-linear-to-br ${typeMeta.gradient}`
                  : 'border-dashed border-slate-300 bg-white'
              }`}
              title={
                isAssigned && passenger
                  ? `Ghế ${s.code} — ${passenger.name || 'Hành khách ' + (passengerIdx + 1)}`
                  : `Ghế ${s.code} — chưa gắn`
              }
            >
              <div className="font-mono font-bold text-xs">{s.code}</div>
              {isAssigned && typeMeta ? (
                <div
                  className={`text-[10px] font-medium ${typeMeta.text} flex items-center justify-center gap-0.5`}
                >
                  {typeMeta.icon}
                  HP{passengerIdx + 1}
                </div>
              ) : (
                <div className="text-[10px] text-slate-400">chưa gắn</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
