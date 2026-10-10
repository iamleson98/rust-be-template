'use client'

import { Armchair, ChevronRight, LogIn, X } from 'lucide-react'
import type { TripSeat } from '@/api'
import { Button } from '@/components/ui/button'
import { SEAT_CLASS_COLORS } from '@/lib/labels'
import { useMoney } from '@/lib/format'
import { useT } from '@/lib/i18n'

/**
 * The trip dialog's sticky footer: every picked seat with its price (tap to drop
 * it), the running total and the button on to checkout.
 */
export function PriceSummary({
  seats,
  maxSeats,
  closed,
  signedIn,
  canProceed,
  onRemove,
  onProceed,
}: {
  seats: TripSeat[]
  maxSeats: number
  /** The trip is no longer on sale. */
  closed: boolean
  /** Signed-out customers sign in on the way to checkout. */
  signedIn: boolean
  canProceed: boolean
  onRemove: (seat: TripSeat) => void
  onProceed: () => void
}) {
  const t = useT()
  const money = useMoney()
  const total = seats.reduce((sum, seat) => sum + seat.finalPrice, 0)
  return (
    <div className="flex shrink-0 items-center gap-3 border-t border-slate-200 bg-white/95 px-4 py-3 backdrop-blur supports-backdrop-filter:bg-white/80 md:gap-4 md:px-6">
      <div className="min-w-0 flex-1">
        {seats.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-500">
              <Armchair className="h-3.5 w-3.5" />
            </span>
            {closed
              ? t('tripDetail.notBookable')
              : t('tripDetail.pickSeatsHint', { max: maxSeats })}
          </div>
        ) : (
          <ul
            className="flex gap-1.5 overflow-x-auto pb-0.5 scrollbar-none"
            aria-label={t('tripDetail.selectedSeats')}
          >
            {seats.map((seat) => (
              <li key={seat.id} className="shrink-0">
                <button
                  type="button"
                  onClick={() => onRemove(seat)}
                  className="group flex items-center gap-1.5 rounded-full border border-slate-200 bg-white py-1 pr-1.5 pl-2 text-xs transition-colors hover:border-rose-300 hover:bg-rose-50"
                  aria-label={t('tripDetail.removeSeat', { code: seat.code })}
                >
                  <span
                    className="h-2 w-2 rounded-full"
                    style={{ background: SEAT_CLASS_COLORS[seat.seatClass ?? 'standard'] }}
                  />
                  <span className="font-mono font-bold">{seat.code}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {money(seat.finalPrice)}
                  </span>
                  <X className="h-3 w-3 text-slate-400 group-hover:text-rose-600" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {seats.length > 0 && (
        <div className="shrink-0 text-right">
          <div className="text-[11px] leading-tight text-slate-500">
            {t('tripDetail.seatsTotal', { count: seats.length })}
          </div>
          <div className="text-lg leading-tight font-extrabold tracking-tight text-slate-900 tabular-nums md:text-xl">
            {money(total)}
          </div>
        </div>
      )}
      <Button
        onClick={onProceed}
        disabled={!canProceed}
        size="lg"
        className="h-11 shrink-0 gap-1.5 rounded-xl px-5 text-sm font-semibold md:h-12 md:px-7 md:text-base"
      >
        {signedIn ? (
          <>
            {t('nav.bookTicket')}
            <ChevronRight className="-mr-1 h-4 w-4" />
          </>
        ) : (
          <>
            <LogIn className="h-4 w-4" />
            {t('tripDetail.signInToBook')}
          </>
        )}
      </Button>
    </div>
  )
}
