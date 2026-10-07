'use client'

/**
 * TripCardPrice — the price + action column of the TripCard.
 *
 * Honesty rules (learned the hard way — see the removed "Flash Sale"
 * countdown and the fabricated review count):
 *   - NO strikethrough "original" price: the API has no original price,
 *     and `minPrice * 1.15` was a made-up number.
 *   - NO price-trend indicator: a tripId hash is not market data.
 * The card shows the real per-seat price, a real range when the backend
 * eventually provides one (maxPrice > minPrice), the real seats-left
 * warning and the CTAs.
 */

import type { TripResult } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { ChevronRight, Flame, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'

/* Price + action — clear hierarchy: seats-left warning first (when real),
   then the price, then the CTA. Wider column (md:w-52) so prices like
   "1.250.000₫" never overflow.
   Mobile: STACKED (price line above the full-width CTA) — the old
   `flex-row` let the w-full action wrapper crush the price block to
   0px width, hiding the fare behind the button. */
export function TripCardPrice({
  trip,
  sellingFast,
  currency,
  onSelect,
  onPriceAlert,
}: {
  trip: TripResult
  sellingFast: boolean
  currency: Currency
  onSelect: () => void
  onPriceAlert: (e: React.MouseEvent) => void
}) {
  const t = useT()
  const hasPriceRange = trip.maxPrice > trip.minPrice

  return (
    <div className="shrink-0 p-3 md:p-4 border-t md:border-t-0 md:border-l border-border/50 bg-slate-50/70 flex flex-col items-stretch md:items-end justify-between gap-2.5 md:w-52">
      <div className="text-left md:text-right min-w-0 w-full md:w-auto">
        {sellingFast && (
          <div className="text-[10px] font-bold text-rose-600 mb-1 flex items-center gap-1 md:justify-end">
            <Flame className="h-3 w-3" />
            {t('searchPage.sellingFast')}
          </div>
        )}
        {/* Current price — prominent, clearly the booking price */}
        <div className="text-xl md:text-2xl font-extrabold text-slate-900 leading-none tabular-nums whitespace-nowrap">
          {formatCurrency(trip.minPrice, currency)}
        </div>
        {/* Per-seat + real range hint (range renders only when the backend
            actually reports one — today maxPrice === minPrice, so this is
            simply the per-seat label). */}
        <div className="text-[10px] text-muted-foreground mt-1.5">
          {hasPriceRange ? t('searchPage.perSeatFrom') : t('searchPage.perSeat')}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 w-full md:w-auto md:min-w-35">
        <Button
          onClick={onSelect}
          size="sm"
          className="bg-primary hover:bg-primary/90 text-primary-foreground gap-1 w-full md:w-auto h-9"
        >
          <span className="flex items-center gap-1">
            {t('searchPage.selectTrip')}
            <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </Button>
        {/* Price alert subscribe button — slim text link */}
        <button
          onClick={onPriceAlert}
          className="w-full md:w-auto inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-700 transition-colors py-0.5"
          title={t('searchPage.trackPriceDrop')}
        >
          <Bell className="h-3 w-3" />
          {t('searchPage.trackPrice')}
        </button>
      </div>
    </div>
  )
}
