'use client'

/**
 * TripCardBrand — the operator block of the TripCard: brand-avatar initials,
 * clickable brand name (navigates to the brand page), the REAL rating
 * (no fabricated review count — `rating * 250` was a made-up number) and
 * the vehicle-type badge.
 *
 * Extracted from the original `trip-card.tsx`.
 */

import type { TripResult } from '@/lib/store'
import { useT } from '@/lib/i18n'
import { Star } from 'lucide-react'
import { Badge } from '@/components/ui/badge'

/* Brand block — compact, balanced */
export function TripCardBrand({
  trip,
  onBrandClick,
}: {
  trip: TripResult
  onBrandClick: (e: React.MouseEvent) => void
}) {
  const t = useT()

  return (
    <div className="md:w-40 shrink-0 bg-slate-50/60 p-3 md:p-3.5 md:border-r border-border/50 flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-2">
      <div
        className="h-11 w-11 rounded-xl flex items-center justify-center text-white font-bold text-sm shrink-0 ring-1 ring-black/5"
        style={{ background: trip.brandAccent }}
      >
        {trip.brandName.split(' ').map((w) => w[0]).join('').slice(0, 2)}
      </div>
      <div className="min-w-0">
        <button
          onClick={onBrandClick}
          className="font-bold text-sm truncate hover:text-blue-700 hover:underline transition-colors text-left max-w-full block"
          title={t('searchPage.viewBrandDetails', { name: trip.brandName })}
        >
          {trip.brandName}
        </button>
        {/* Real rating straight from the API — shown alone, no invented
            review count next to it. */}
        <div className="flex items-center gap-1 text-xs text-amber-500 mt-0.5">
          <Star className="h-3 w-3 fill-current" />
          <span className="font-semibold text-slate-700">{trip.brandRating.toFixed(1)}</span>
          <span className="text-[10px] text-muted-foreground">/ 5</span>
        </div>
        <Badge variant="secondary" className="mt-1.5 text-[10px] font-medium px-1.5">
          {trip.vehicleTypeLabel}
        </Badge>
      </div>
    </div>
  )
}
