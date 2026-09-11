'use client'

/**
 * TripCardPrice — the price + action column of the TripCard: strikethrough
 * original price, current price with trend indicator, per-seat hint, the
 * "Chọn chuyến" CTA and the price-alert text link.
 *
 * Extracted from the original `trip-card.tsx`; the price-trend helpers and
 * the original-price/range computations moved here with it.
 */

import type { TripResult } from '@/lib/store'
import { ChevronRight, TrendingUp, TrendingDown, Minus, Bell } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { formatCurrency } from '@/lib/currency'
import type { Currency } from '@/lib/currency'

/** Deterministic price trend from tripId hash */
function getPriceTrend(tripId: string): 'up' | 'down' | 'stable' {
  let hash = 0
  for (let i = 0; i < tripId.length; i++) {
    hash = ((hash << 5) - hash + tripId.charCodeAt(i)) | 0
  }
  const mod = Math.abs(hash) % 3
  return mod === 0 ? 'up' : mod === 1 ? 'down' : 'stable'
}

const TREND_CONFIG = {
  up: { icon: TrendingUp, label: 'Giá tăng', color: 'text-rose-500' },
  down: { icon: TrendingDown, label: 'Giá giảm', color: 'text-blue-500' },
  stable: { icon: Minus, label: 'Giá ổn định', color: 'text-slate-400' },
}

/* Price + action — clean hierarchy: strikethrough first, then current price, then CTA.
   Wider column (md:w-56) so prices like "1.250.000₫" never overflow. */
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
  // Price calculations
  const originalPrice = Math.round(trip.minPrice * 1.15)
  const hasPriceRange = trip.maxPrice > trip.minPrice

  // Price trend
  const priceTrend = getPriceTrend(trip.tripId)
  const trendCfg = TREND_CONFIG[priceTrend]
  const TrendIcon = trendCfg.icon

  return (
    <div className="shrink-0 p-3 md:p-4 border-t md:border-t-0 md:border-l border-border/50 bg-linear-to-br from-slate-50 to-slate-100/60 flex flex-row md:flex-col items-center md:items-end justify-between gap-2.5 md:w-56">
      <div className="text-left md:text-right min-w-0 flex-1 md:flex-none">
        {sellingFast && (
          <div className="text-[10px] font-bold text-rose-600 mb-1 flex items-center gap-1 md:justify-end">
            <TrendingUp className="h-3 w-3" />
            Bán nhanh
          </div>
        )}
        {/* Strikethrough original price — clearly visible as the "was" price */}
        <div className="text-xs text-slate-400 line-through decoration-slate-400 decoration-1 leading-none">
          {formatCurrency(originalPrice, currency)}
        </div>
        {/* Current price — prominent, dark, clearly the "now" price */}
        <div className="flex items-baseline md:justify-end gap-1 mt-1">
          <div className="text-xl md:text-[26px] font-bold text-slate-900 leading-none tabular-nums">
            {formatCurrency(trip.minPrice, currency)}
          </div>
          {/* Price trend indicator */}
          <Tooltip>
            <TooltipTrigger asChild>
              <span className={`inline-flex items-center ${trendCfg.color} cursor-default`}>
                <TrendIcon className="h-3.5 w-3.5" />
              </span>
            </TooltipTrigger>
            <TooltipContent side="top">
              {trendCfg.label}
            </TooltipContent>
          </Tooltip>
        </div>
        {/* Per-seat + range hint combined in one line */}
        <div className="text-[10px] text-muted-foreground mt-1">
          {hasPriceRange ? 'từ /ghế' : '/ghế'}
        </div>
      </div>
      <div className="flex flex-col gap-1.5 w-full md:w-auto md:min-w-35">
        <Button
          onClick={onSelect}
          size="sm"
          className="bg-slate-900 hover:bg-slate-800 text-white gap-1.5 transition-all w-full md:w-auto h-9  group-hover:bg-blue-600"
        >
          <span className="flex items-center gap-1">
            Chọn chuyến
            <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
          </span>
        </Button>
        {/* Price alert subscribe button — slim text link */}
        <button
          onClick={onPriceAlert}
          className="w-full md:w-auto inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-700 transition-colors py-0.5"
          title="Theo dõi khi giá giảm"
        >
          <Bell className="h-3 w-3" />
          Theo dõi giá
        </button>
      </div>
    </div>
  )
}
