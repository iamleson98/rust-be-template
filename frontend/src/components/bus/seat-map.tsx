'use client'

import { cn } from '@/lib/utils'
import { SEAT_CLASS_LABELS, SEAT_CLASS_COLORS, formatVND } from '@/lib/types'
import { SteeringWheel } from './icons'
import { Check } from 'lucide-react'

export type SeatInv = {
  id: string
  status: string // available, locked, booked, blocked
  finalPrice: number
  // Flat seat properties (matches the backend API response — the
  // legacy `seat: { ... }` wrapper was removed when we migrated to Rust).
  code: string
  deck: number
  row: number
  col: number
  seatClass: string
  amenities: string
  seatId?: string
}

type Props = {
  decks: { deck: number; rows: { row: number; seats: (SeatInv | null)[] }[] }[]
  selectedSeatIds: string[]
  onToggleSeat: (seatId: string) => void
  maxSeats: number
}

export function SeatMap({ decks, selectedSeatIds, onToggleSeat, maxSeats }: Props) {
  return (
    <div className="space-y-5">
      {decks.map((d) => {
        // Compute a global seat counter per deck for stagger delay
        let seatCounter = 0
        return (
          <div key={d.deck} className="rounded-xl border-2 border-slate-200 overflow-hidden">
            {decks.length > 1 && (
              <div className="bg-slate-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 flex items-center justify-between">
                <span>{d.deck === 1 ? 'Tầng dưới' : 'Tầng trên'}</span>
                <span className="text-muted-foreground">Tầng {d.deck}</span>
              </div>
            )}
            <div className="p-3 sm:p-5 bg-linear-to-b from-slate-50 to-white">
              {/* Bus front */}
              <div className="flex justify-center mb-3">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800 text-white text-xs font-semibold">
                  <SteeringWheel className="h-3.5 w-3.5" />
                  Tài xế
                </div>
              </div>

              <div className="space-y-2">
                {d.rows.map((r) => (
                  <div key={r.row} className="flex items-center justify-center gap-1.5">
                    {/* Row number */}
                    <div className="w-5 text-[10px] text-slate-400 text-right shrink-0">{r.row}</div>
                    {r.seats.map((seat, i) => {
                      // aisle gap after col 2 typically
                      const isAisleGap = i > 0 && r.seats[i - 1] === null && seat !== null
                      // Stagger delay: 40ms per seat, capped at 600ms
                      const stagger = seat ? Math.min(seatCounter++ * 40, 600) : 0
                      return seat === null ? (
                        <div key={`gap-${i}`} className="w-9 sm:w-11" aria-hidden />
                      ) : (
                        <SeatButton
                          key={seat.id}
                          seat={seat}
                          selected={selectedSeatIds.includes(seat.id)}
                          disabled={
                            seat.status !== 'available' ||
                            (selectedSeatIds.length >= maxSeats && !selectedSeatIds.includes(seat.id))
                          }
                          onClick={() => onToggleSeat(seat.id)}
                          staggerDelay={stagger}
                        />
                      )
                    })}
                    <div className="w-5 shrink-0" />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )
      })}

      {/* Legend */}
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <LegendItem className="bg-white border-2 border-slate-300" label="Còn trống" />
        <LegendItem className="bg-blue-600 text-white" label="Đang chọn" />
        <LegendItem className="bg-slate-300 text-slate-500" label="Đã đặt" />
        <LegendItem className="bg-amber-200 border border-amber-400" label="Đang giữ" />
        <div className="w-px h-4 bg-slate-300 mx-1" />
        {Object.entries(SEAT_CLASS_COLORS).map(([cls, color]) => (
          <div key={cls} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded" style={{ background: color }} />
            <span className="text-muted-foreground">{SEAT_CLASS_LABELS[cls]}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function SeatButton({
  seat,
  selected,
  disabled,
  onClick,
  staggerDelay = 0,
}: {
  seat: SeatInv
  selected: boolean
  disabled: boolean
  onClick: () => void
  staggerDelay?: number
}) {
  const status = seat.status
  const cls = seat.seatClass
  const color = SEAT_CLASS_COLORS[cls] ?? '#64748b'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${seat.code} • ${SEAT_CLASS_LABELS[cls] ?? cls} • ${formatVND(seat.finalPrice)}`}
      className={cn(
        'relative h-9 w-9 sm:h-10 sm:w-10 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all ',
        'border-2',
        selected
          ? 'bg-blue-600 text-white border-blue-700 scale-105'
          : status === 'available'
            ? 'bg-white text-slate-700 hover:border-blue-400 '
            : status === 'locked'
              ? 'bg-amber-100 text-amber-700 border-amber-300 cursor-not-allowed'
              : 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed line-through'
      )}
      style={{
        animationDelay: `${staggerDelay}ms`,
        // Animation fill mode ensures seat is invisible until its delay elapses
        animationFillMode: 'both',
        ...(!selected && status === 'available' ? { borderColor: `${color}40` } : {}),
      }}
    >
      {selected ? <Check className="h-4 w-4" /> : seat.code}
      {/* class color dot */}
      {!selected && status === 'available' && (
        <span
          className="absolute -top-1 -right-1 h-2 w-2 rounded-full ring-1 ring-white"
          style={{ background: color }}
        />
      )}
    </button>
  )
}

function LegendItem({ className, label }: { className: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className={cn('h-4 w-4 rounded', className)} />
      <span className="text-muted-foreground">{label}</span>
    </div>
  )
}
