'use client'

import { useMemo } from 'react'
import { cn } from '@/lib/utils'
import { SEAT_CLASS_LABELS, SEAT_CLASS_COLORS, formatVND } from '@/lib/types'
import { useT } from '@/lib/i18n'
import { SteeringWheel } from '@/components/icons/icons'
import { Check, Info } from 'lucide-react'

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

/** Short price-difference label: "+50k" for seats priced above the
 *  cheapest available seat on the trip. Values come straight from the
 *  API (`finalPrice` per seat) — no rounding tricks, just compact
 *  formatting for the tiny corner tag. */
function formatPriceDiff(diff: number): string {
  if (diff >= 1000) {
    const k = diff / 1000
    // Round to nearest 0.5k, drop trailing .0 (e.g. 50k, 12.5k)
    const rounded = Math.round(k * 2) / 2
    return `+${rounded % 1 === 0 ? rounded.toFixed(0) : rounded.toFixed(1)}k`
  }
  return `+${diff}`
}

export function SeatMap({ decks, selectedSeatIds, onToggleSeat, maxSeats }: Props) {
  const t = useT()

  // Cheapest available seat price across all decks — the baseline the
  // per-seat "+XXk" surcharge tags are measured against (real data).
  const cheapestAvailable = useMemo(() => {
    let min: number | null = null
    for (const d of decks) {
      for (const r of d.rows) {
        for (const s of r.seats) {
          if (s && s.status === 'available' && (min === null || s.finalPrice < min)) {
            min = s.finalPrice
          }
        }
      }
    }
    return min
  }, [decks])

  return (
    <div className="space-y-5">
      {/* Instructional banner — guides the user on how to select seats */}
      <div className="flex items-start gap-2 rounded-lg bg-info/5 border border-info/20 p-3 text-xs text-muted-foreground">
        <Info className="h-4 w-4 text-info shrink-0 mt-0.5" />
        <div>
          <span className="font-medium text-info-foreground">{t('trips.seatGuideTitle')}</span>{' '}
          {t('trips.seatGuideBody', { count: maxSeats })}
        </div>
      </div>

      {decks.map((d) => {
        // Compute a global seat counter per deck for stagger delay
        let seatCounter = 0
        return (
          <div key={d.deck} className="rounded-xl border-2 border-slate-200 overflow-hidden">
            {decks.length > 1 && (
              <div className="bg-slate-100 px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-slate-600 flex items-center justify-between">
                <span>{d.deck === 1 ? t('trips.deckLower') : t('trips.deckUpper')}</span>
                <span className="text-muted-foreground">
                  {t('trips.deckLabel', { deck: d.deck })}
                </span>
              </div>
            )}
            <div className="p-3 sm:p-5 bg-linear-to-b from-slate-50 to-white">
              {/* Bus front */}
              <div className="flex justify-center mb-3">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-slate-800 text-white text-xs font-semibold">
                  <SteeringWheel className="h-3.5 w-3.5" />
                  {t('trips.driver')}
                </div>
              </div>

              <div className="space-y-2">
                {d.rows.map((r) => (
                  <div key={r.row} className="flex items-center justify-center gap-1.5">
                    {/* Row number */}
                    <div className="w-5 text-[10px] text-slate-400 text-right shrink-0">
                      {r.row}
                    </div>
                    {r.seats.map((seat, i) => {
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
                            (selectedSeatIds.length >= maxSeats &&
                              !selectedSeatIds.includes(seat.id))
                          }
                          onClick={() => onToggleSeat(seat.id)}
                          staggerDelay={stagger}
                          priceDiff={
                            cheapestAvailable !== null &&
                            seat.status === 'available' &&
                            seat.finalPrice > cheapestAvailable
                              ? seat.finalPrice - cheapestAvailable
                              : 0
                          }
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

      {/* Legend — status chips + per-class color dots, all in one wrap row */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5 text-xs">
        <LegendItem
          className="bg-white border-2 border-slate-300"
          label={t('trips.legendAvailable')}
        />
        <LegendItem
          className="bg-primary text-primary-foreground"
          label={t('trips.legendSelected')}
        />
        <LegendItem className="bg-slate-300 text-slate-500" label={t('trips.legendBooked')} />
        <LegendItem
          className="bg-warning/30 border border-warning/50"
          label={t('trips.legendHeld')}
        />
        <div className="w-px h-4 bg-slate-300 mx-0.5" aria-hidden />
        {Object.entries(SEAT_CLASS_COLORS).map(([cls, color]) => (
          <div key={cls} className="flex items-center gap-1.5">
            <span className="h-3 w-3 rounded-sm" style={{ background: color }} />
            <span className="text-muted-foreground">{t(SEAT_CLASS_LABELS[cls] ?? cls)}</span>
          </div>
        ))}
        {cheapestAvailable !== null && (
          <>
            <div className="w-px h-4 bg-slate-300 mx-0.5" aria-hidden />
            <span className="text-muted-foreground">
              {t('trips.legendBasePrice')}:{' '}
              <span className="font-semibold text-slate-700">{formatVND(cheapestAvailable)}</span>
            </span>
          </>
        )}
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
  priceDiff = 0,
}: {
  seat: SeatInv
  selected: boolean
  disabled: boolean
  onClick: () => void
  staggerDelay?: number
  /** Real surcharge vs the trip's cheapest available seat (0 = none). */
  priceDiff?: number
}) {
  const t = useT()
  const status = seat.status
  const cls = seat.seatClass
  const color = SEAT_CLASS_COLORS[cls ?? 'standard'] ?? '#64748b'
  // Grid-generated seats carry no seatClass — label them "standard"
  // instead of rendering a literal "undefined" in title/aria-label.
  const classLabelKey = SEAT_CLASS_LABELS[cls ?? 'standard'] ?? 'types.seatStandard'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={`${seat.code} • ${t(classLabelKey)} • ${formatVND(seat.finalPrice)}`}
      aria-label={t('trips.seatAriaLabel', {
        code: seat.code,
        seatClass: t(classLabelKey),
        price: formatVND(seat.finalPrice),
        status: selected
          ? t('trips.seatStatusSelected')
          : status === 'available'
            ? t('trips.seatStatusAvailable')
            : t('trips.seatStatusOccupied'),
      })}
      aria-pressed={selected}
      className={cn(
        'relative h-11 w-11 rounded-lg text-[10px] font-bold flex items-center justify-center transition-all',
        'border-2',
        selected
          ? 'bg-primary text-primary-foreground border-primary scale-105'
          : status === 'available'
            ? 'bg-white text-slate-700 hover:border-primary/50 hover:-translate-y-0.5'
            : status === 'locked'
              ? 'bg-warning/20 text-warning-foreground border-warning/40 cursor-not-allowed'
              : 'bg-slate-200 text-slate-400 border-slate-300 cursor-not-allowed line-through',
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
      {/* REAL surcharge tag — only for available seats priced above the
          trip's cheapest seat. Keeps premium-class pricing transparent
          right on the map instead of a hover-only tooltip. */}
      {priceDiff > 0 && !selected && (
        <span
          className="absolute -top-2 -left-2 rounded-full bg-amber-500 text-white text-[10px] font-bold px-1 py-px leading-none ring-1 ring-white"
          aria-hidden
        >
          {formatPriceDiff(priceDiff)}
        </span>
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
