'use client'

import type { TripResult } from '@/api'
import { memo, useCallback } from 'react'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatTimeVN, parseDateSafe } from '@/lib/format'
import { GitCompare, Sparkles, Share2, ArrowRight } from 'lucide-react'
import { useUi } from '@/stores/ui'
import { useGuest } from '@/stores/guest'
import { usePrefs } from '@/stores/prefs'
import { useSearchForm } from '@/stores/search-form'
import { useT } from '@/lib/i18n'
import { useQueryClient } from '@tanstack/react-query'
import { tripDetailOptions } from '@/api'
import { useNavigate } from '@tanstack/react-router'
import { toast } from 'sonner'
import { TripCardAmenities, TripCardAmenitiesMobile } from './trip-card-amenities'
import { TripCardPrice } from './trip-card-price'
import { TripCardBrand } from './trip-card-brand'

/** Format a date to short dd/mm for overnight trip display ('' when
 *  the value is missing/unparseable — e.g. arrivalAt is null for
 *  schedules without configured arrival times). Parses via
 *  parseDateSafe so timezone-less ISO strings are read as Vietnam time. */
function formatShortDate(dateStr: string | null | undefined): string {
  const d = parseDateSafe(dateStr)
  if (!d) return ''
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d)
}

/** Check if arrival date differs from departure date (overnight trip).
 *  False when either timestamp is missing — no arrival info means we
 *  can't know, so we simply don't badge it. */
function isOvernight(
  departureAt: string | null | undefined,
  arrivalAt: string | null | undefined,
): boolean {
  const dep = parseDateSafe(departureAt)
  const arr = parseDateSafe(arrivalAt)
  if (!dep || !arr) return false
  // Same dd/mm-in-Vietnam format as formatShortDate — an overnight
  // trip is exactly "the short dates differ".
  return formatShortDate(departureAt) !== formatShortDate(arrivalAt)
}

export const TripCard = memo(function TripCard({
  trip,
  onSelect,
  isRecommended = false,
}: {
  trip: TripResult
  onSelect?: () => void
  isRecommended?: boolean
}) {
  const lowSeats = trip.availableSeats <= 5 && trip.availableSeats > 0
  const sellingFast = trip.availableSeats <= 3 && trip.availableSeats > 0
  const toggleCompare = useUi((s) => s.toggleCompare)
  const compareCount = useUi((s) => s.compareList.length)
  const inCompare = useUi((s) => s.compareList.includes(trip.tripId))
  const openPriceAlert = useUi((s) => s.openPriceAlert)
  const openShare = useUi((s) => s.openShare)
  const pushRecentlyViewed = useGuest((s) => s.pushRecentlyViewed)
  const searchDate = useSearchForm((s) => s.searchParams.date)
  const currency = usePrefs((s) => s.currency)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const t = useT()

  // Prefetch trip detail on hover so clicking feels instant — the dialog
  // reads from the same query cache, so when the user clicks the result is
  // already there. We use prefetchQuery (no throw on failure) with a long
  // staleTime so the prefetched entry isn't immediately re-fetched.
  const handleHoverPrefetch = useCallback(() => {
    const opts = tripDetailOptions({ path: { id: trip.tripId } })
    queryClient.prefetchQuery({
      queryKey: opts.queryKey,
      queryFn: opts.queryFn,
      staleTime: 60 * 1000,
    })
  }, [queryClient, trip.tripId])

  // Overnight trip detection — arrivalAt comes from the schedule's last
  // stop; trips without configured arrival times simply don't badge.
  const overnight = isOvernight(trip.departureAt, trip.arrivalAt)
  // Date differs from search date?
  const searchDateShort = searchDate ? formatShortDate(searchDate + 'T00:00:00+07:00') : null
  const departureDateShort = formatShortDate(trip.departureAt)
  const arrivalDateShort = formatShortDate(trip.arrivalAt)
  const showDepartureDate = !!(
    searchDateShort &&
    departureDateShort &&
    departureDateShort !== searchDateShort
  )
  const showArrivalDate = !!(
    departureDateShort &&
    arrivalDateShort &&
    departureDateShort !== arrivalDateShort
  )

  // Amenities overflow
  const maxVisibleAmenities = 4
  const overflowCount = Math.max(0, trip.amenities.length - maxVisibleAmenities)

  // Seat availability percentage
  const seatAvailPct = trip.totalSeats > 0 ? (trip.availableSeats / trip.totalSeats) * 100 : 100
  const availBarColor =
    seatAvailPct > 50 ? 'bg-blue-500' : seatAvailPct > 20 ? 'bg-amber-500' : 'bg-rose-500'

  const handleSelect = () => {
    // Push to recently viewed
    pushRecentlyViewed({
      tripId: trip.tripId,
      routeId: trip.routeId,
      label: `${trip.fromName} → ${trip.toName}`,
      brandName: trip.brandName,
    })
    // Delegate navigation to the caller via onSelect — the search-results
    // page (and any other consumer) passes `() => navigate({ to: '/trips/$tripId', ... })`
    // so the URL becomes the source of truth. This keeps TripCard
    // navigation-agnostic (no double-navigate race) while preserving
    // side-effects like recently-viewed tracking.
    onSelect?.()
  }

  const handleCompareToggle = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!inCompare && compareCount >= 3) {
      toast.info(t('searchPage.compareMax'))
      return
    }
    toggleCompare(trip.tripId)
    toast.success(inCompare ? t('searchPage.compareRemoved') : t('searchPage.compareAdded'))
  }

  const handleBrandClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate({ to: '/brands/$slug', params: { slug: trip.brandSlug } })
  }

  const handlePriceAlert = (e: React.MouseEvent) => {
    e.stopPropagation()
    openPriceAlert({ fromName: trip.fromName, toName: trip.toName, minPrice: trip.minPrice })
  }

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation()
    openShare({
      tripId: trip.tripId,
      fromName: trip.fromName,
      toName: trip.toName,
      departureAt: trip.departureAt ?? undefined,
      departureTime: trip.departureTime ?? undefined,
      brandName: trip.brandName,
      brandAccent: trip.brandAccent,
      brandRating: trip.brandRating ?? undefined,
      minPrice: trip.minPrice,
      vehicleTypeLabel: trip.vehicleTypeLabel,
    })
  }

  // The share/compare cluster — rendered inline (NOT absolute) so it can
  // never overlap the price column. Shared by the desktop time-row (as a
  // trailing element) and the mobile header row.
  const quickActions = (
    <div className="flex items-center gap-1.5 shrink-0">
      <button
        onClick={handleCompareToggle}
        title={t('searchPage.addToCompare')}
        aria-pressed={inCompare}
        className={`h-8 w-8 rounded-full inline-flex items-center justify-center transition-colors ${
          inCompare
            ? 'bg-violet-600 text-white'
            : 'bg-slate-50 text-slate-500 hover:bg-violet-50 hover:text-violet-600 ring-1 ring-slate-200'
        }`}
      >
        <GitCompare className="h-3.5 w-3.5" />
      </button>
      <button
        onClick={handleShare}
        title={t('searchPage.shareTrip')}
        className="h-8 w-8 rounded-full inline-flex items-center justify-center bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600 ring-1 ring-slate-200 transition-colors"
      >
        <Share2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  return (
    <div onMouseEnter={handleHoverPrefetch} data-testid="trip-card">
      {/* Blue border highlight on hover — no lift, no transform, no
          colored rings (per the flat user-page design language). */}
      <Card className="overflow-visible border-border/60 hover:border-primary/40 transition-colors group relative">
        {/* Recommended badge — sits flush on the top-left, above content */}
        {isRecommended && (
          <div className="absolute -top-2 left-3 z-20">
            <Badge className="bg-amber-500 text-white gap-1 text-[10px] font-bold hover:bg-amber-500">
              <Sparkles className="h-3 w-3" />
              {t('searchPage.recommended')}
            </Badge>
          </div>
        )}

        <div className="flex flex-col md:flex-row">
          <TripCardBrand trip={trip} onBrandClick={handleBrandClick} />

          {/* Main content */}
          <div className="flex-1 p-3 md:p-3.5 min-w-0">
            {/* Mobile quick actions — inline row, never overlap content */}
            <div className="md:hidden flex justify-end mb-2">{quickActions}</div>

            <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
              {/* Time + route — SYMMETRIC slots: departure time + start
                  city on the left, arrival time + end city on the right
                  (same value types on both ends). Fixed min widths so
                  times never clip; names truncate instead of wrapping
                  into the connector. */}
              <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                <div className="text-center shrink-0 min-w-15">
                  <div className="text-xl md:text-2xl font-bold leading-tight tabular-nums text-slate-900">
                    {trip.departureTime}
                  </div>
                  {showDepartureDate && (
                    <div className="text-[10px] text-blue-600 font-medium">
                      {departureDateShort}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-22.5 mx-auto">
                    {trip.fromName}
                  </div>
                </div>

                <div className="flex-1 min-w-12.5 md:min-w-17.5 max-w-32.5 relative flex items-center justify-center">
                  <div className="w-full border-t-2 border-dashed border-slate-200 group-hover:border-blue-300 transition-colors" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    {overnight ? (
                      <div className="bg-white px-1.5 text-[10px] text-amber-600 font-semibold whitespace-nowrap ring-1 ring-amber-200 rounded-full">
                        {t('searchPage.plusOneDay')}
                      </div>
                    ) : (
                      <span className="h-5 w-5 rounded-full bg-white ring-1 ring-slate-200 flex items-center justify-center text-slate-400 group-hover:text-blue-600 group-hover:ring-blue-300 transition-colors">
                        <ArrowRight className="h-3 w-3" />
                      </span>
                    )}
                  </div>
                </div>

                <div className="text-center shrink-0 min-w-15">
                  {trip.arrivalAt ? (
                    <>
                      <div className="text-xl md:text-2xl font-bold leading-tight tabular-nums text-slate-900">
                        {formatTimeVN(trip.arrivalAt)}
                      </div>
                      {showArrivalDate && (
                        <div className="text-[10px] text-blue-600 font-medium">
                          {arrivalDateShort}
                        </div>
                      )}
                    </>
                  ) : (
                    /* Data gap (schedule has no arrival times configured):
                     * the destination takes the slot with a "view detail"
                     * hint — honest, never an orphaned dash. */
                    <div className="text-base md:text-lg font-semibold leading-tight text-slate-900">
                      {trip.toName}
                    </div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-22.5 mx-auto">
                    {trip.arrivalAt ? trip.toName : t('searchPage.viewArrival')}
                  </div>
                </div>

                {/* Desktop quick actions — trailing element of the time
                    row: right-aligned in the content area, structurally
                    clear of the price column (no more absolute overlap). */}
                <div className="hidden md:flex ml-auto">{quickActions}</div>
              </div>

              <TripCardAmenities
                trip={trip}
                maxVisibleAmenities={maxVisibleAmenities}
                overflowCount={overflowCount}
                lowSeats={lowSeats}
                sellingFast={sellingFast}
                availBarColor={availBarColor}
                seatAvailPct={seatAvailPct}
              />
            </div>

            <TripCardAmenitiesMobile
              trip={trip}
              maxVisibleAmenities={maxVisibleAmenities}
              overflowCount={overflowCount}
              lowSeats={lowSeats}
              sellingFast={sellingFast}
              availBarColor={availBarColor}
              seatAvailPct={seatAvailPct}
            />
          </div>

          <TripCardPrice
            trip={trip}
            sellingFast={sellingFast}
            currency={currency}
            onSelect={handleSelect}
            onPriceAlert={handlePriceAlert}
          />
        </div>
      </Card>
    </div>
  )
})
