'use client'

/**
 * PriceSummary — sticky CTA bar at the bottom of the TripDetailDialog.
 *
 * Shows the running total of selected seats + the proceed-to-booking
 * button (disabled until the user has selected the required number of
 * seats AND both pickup/dropoff points).
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 606-659). Pure refactor.
 */

import { Button } from '@/components/ui/button'
import { Armchair, AlertTriangle, CheckCircle2, ChevronRight } from 'lucide-react'
import { formatCurrency, type Currency } from '@/lib/currency'

export function PriceSummary({
  selectedSeatsCount,
  maxSeats,
  total,
  canProceed,
  onProceed,
  currency,
}: {
  selectedSeatsCount: number
  maxSeats: number
  total: number
  canProceed: boolean
  onProceed: () => void
  currency: Currency
}) {
  return (
    <div className="border-t border-slate-200 bg-white/95 backdrop-blur supports-backdrop-filter:bg-white/80 px-4 md:px-6 py-3 md:py-3.5 flex items-center justify-between gap-3 md:gap-4 shrink-0">
      <div className="flex-1 min-w-0">
        {selectedSeatsCount === 0 ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <div className="h-7 w-7 rounded-full bg-slate-100 text-slate-500 inline-flex items-center justify-center">
              <Armchair className="h-3.5 w-3.5" />
            </div>
            <span>
              Vui lòng chọn <span className="font-semibold text-foreground">{maxSeats}</span> ghế để tiếp tục
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-3 md:gap-4">
            <div className="flex items-center gap-2 text-sm">
              <div className="h-9 w-9 rounded-xl bg-linear-to-br from-blue-500 to-blue-600 text-white inline-flex items-center justify-center font-bold text-xs ">
                {selectedSeatsCount}
              </div>
              <div>
                <div className="font-semibold leading-tight text-slate-800">
                  {selectedSeatsCount}/{maxSeats} ghế
                </div>
                {selectedSeatsCount !== maxSeats ? (
                  <div className="text-[11px] text-amber-600 leading-tight flex items-center gap-1 mt-0.5">
                    <AlertTriangle className="h-3 w-3" />
                    Cần chọn thêm {maxSeats - selectedSeatsCount} ghế
                  </div>
                ) : (
                  <div className="text-[11px] text-blue-600 leading-tight flex items-center gap-1 mt-0.5">
                    <CheckCircle2 className="h-3 w-3" />
                    Đã đủ ghế
                  </div>
                )}
              </div>
            </div>
            <div className="h-9 w-px bg-slate-200" />
            <div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground leading-tight">Tổng tiền</div>
              <div className="font-extrabold text-blue-800 text-lg md:text-xl leading-tight">{formatCurrency(total, currency)}</div>
            </div>
          </div>
        )}
      </div>
      <Button
        onClick={onProceed}
        disabled={!canProceed}
        className="bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700 disabled:opacity-50 gap-2 shrink-0 h-11 md:h-12 px-5 md:px-7 text-sm md:text-base font-semibold"
        size="lg"
      >
        <CheckCircle2 className="h-4 w-4" />
        Đặt vé
        <ChevronRight className="h-4 w-4 -mr-1" />
      </Button>
    </div>
  )
}
