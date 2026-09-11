'use client'

/**
 * TripCardBrand — the operator block of the TripCard: brand-avatar initials,
 * clickable brand name (navigates to the brand page), rating + review count
 * and the vehicle-type badge.
 *
 * Extracted from the original `trip-card.tsx`; the review-count helper and
 * the vehicle-emoji computation moved here with it.
 */

import type { TripResult } from '@/lib/store'
import { VEHICLE_TYPE_ICONS } from '@/lib/types'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/** Format review count compactly e.g. 1200 -> "1.2k" */
function formatReviewCount(count: number): string {
  if (count >= 1000) {
    const val = count / 1000
    return val >= 10 ? `${Math.round(val)}k` : `${val.toFixed(1)}k`
  }
  return String(count)
}

/* Brand block — compact, balanced */
export function TripCardBrand({
  trip,
  onBrandClick,
}: {
  trip: TripResult
  onBrandClick: (e: React.MouseEvent) => void
}) {
  // Vehicle type emoji
  const vehicleEmoji = VEHICLE_TYPE_ICONS[trip.vehicleType] ?? '🚌'

  // Review count (deterministic from brandRating to avoid random per-render)
  const reviewCount = Math.floor(trip.brandRating * 250 + (trip.brandName.length * 17) % 100)

  return (
    <div className="md:w-40 shrink-0 bg-slate-50/60 p-3 md:p-3.5 md:border-r border-border/50 flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-2">
      <div
        className="h-11 w-11 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 ring-1 ring-black/5"
        style={{ background: trip.brandAccent }}
      >
        {trip.brandName.split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
      <div className="min-w-0">
        <button
          onClick={onBrandClick}
          className="font-bold text-sm truncate hover:text-blue-700 hover:underline transition-colors text-left max-w-full block"
          title={`Xem chi tiết ${trip.brandName}`}
        >
          {trip.brandName}
        </button>
        <div className="flex items-center gap-1 text-xs text-amber-500 mt-0.5">
          <Star className="h-3 w-3 fill-current" />
          <span className="font-semibold">{trip.brandRating.toFixed(1)}</span>
          <span className="text-[10px] text-muted-foreground">({formatReviewCount(reviewCount)})</span>
        </div>
        <Badge variant="secondary" className="mt-1.5 text-[10px] font-medium gap-1 px-1.5">
          <span>{vehicleEmoji}</span>
          {trip.vehicleTypeLabel}
        </Badge>
      </div>
    </div>
  )
}
