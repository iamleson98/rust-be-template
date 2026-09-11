'use client'

import { memo, useCallback } from 'react'
import type { TripResult } from '@/lib/store'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { formatTimeVN } from '@/lib/types'
import { GitCompare, Sparkles, Share2 } from 'lucide-react'
import { useApp } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useQueryClient } from '@tanstack/react-query'
import { tripDetailOptions } from '@/lib/api/@tanstack/react-query.gen'
import { useNavigate } from '@/router'
import { WishlistButton } from '@/features/wishlist/wishlist-button'
import { toast } from 'sonner'
import { TripCardAmenities, TripCardAmenitiesMobile } from './trip-card-amenities'
import { TripCardPrice } from './trip-card-price'
import { TripCardBrand } from './trip-card-brand'

/** Format a date to short dd/mm for overnight trip display */
function formatShortDate(dateStr: string): string {
  const d = typeof dateStr === 'string' ? new Date(dateStr) : dateStr
  return new Intl.DateTimeFormat('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    timeZone: 'Asia/Ho_Chi_Minh',
  }).format(d)
}

/** Check if arrival date differs from departure date (overnight trip) */
function isOvernight(departureAt: string, arrivalAt: string): boolean {
  const dep = new Date(departureAt)
  const arr = new Date(arrivalAt)
  const fmt = (d: Date) =>
    new Intl.DateTimeFormat('vi-VN', {
      day: '2-digit',
      month: '2-digit',
      timeZone: 'Asia/Ho_Chi_Minh',
    }).format(d)
  return fmt(dep) !== fmt(arr)
}

export const TripCard = memo(function TripCard({ trip, onSelect, index = 0, isRecommended = false }: { trip: TripResult; onSelect?: () => void; index?: number; isRecommended?: boolean }) {
  const lowSeats = trip.availableSeats <= 5 && trip.availableSeats > 0
  const sellingFast = trip.availableSeats <= 3 && trip.availableSeats > 0
  const { toggleCompare, compareList, pushRecentlyViewed, searchParams, setPriceAlertOpen, setPriceAlertContext, currency, setShareOpen, setShareTripData } = useApp(useShallow((s) => ({
    toggleCompare: s.toggleCompare,
    compareList: s.compareList,
    pushRecentlyViewed: s.pushRecentlyViewed,
    searchParams: s.searchParams,
    setPriceAlertOpen: s.setPriceAlertOpen,
    setPriceAlertContext: s.setPriceAlertContext,
    currency: s.currency,
    setShareOpen: s.setShareOpen,
    setShareTripData: s.setShareTripData,
  })))
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const inCompare = compareList.includes(trip.tripId)

  // Prefetch trip detail on hover so clicking feels instant — the dialog
  // reads from the same query cache, so when the user clicks the result is
  // already there. We use prefetchQuery (no throw on failure) with a long
  // staleTime so the prefetched entry isn't immediately re-fetched.
  const handleHoverPrefetch = useCallback(() => {
    const opts = tripDetailOptions({ path: { id: trip.tripId } })
    queryClient.prefetchQuery({
      queryKey: opts.queryKey,
      queryFn: opts.queryFn as any,
      staleTime: 60 * 1000,
    })
  }, [queryClient, trip.tripId])

  // Overnight trip detection
  const overnight = isOvernight(trip.departureAt ?? '', trip.arrivalAt ?? '')
  // Date differs from search date?
  const searchDateShort = searchParams.date ? formatShortDate(searchParams.date + 'T00:00:00+07:00') : null
  const departureDateShort = formatShortDate(trip.departureAt ?? '')
  const arrivalDateShort = formatShortDate(trip.arrivalAt ?? '')
  const showDepartureDate = searchDateShort && departureDateShort !== searchDateShort
  const showArrivalDate = departureDateShort !== arrivalDateShort

  // Amenities overflow
  const maxVisibleAmenities = 4
  const overflowCount = Math.max(0, trip.amenities.length - maxVisibleAmenities)

  // Seat availability percentage
  const seatAvailPct = trip.totalSeats > 0 ? (trip.availableSeats / trip.totalSeats) * 100 : 100
  const availBarColor = seatAvailPct > 50 ? 'bg-blue-500' : seatAvailPct > 20 ? 'bg-amber-500' : 'bg-rose-500'

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
    if (!inCompare && compareList.length >= 3) {
      toast.info('Chỉ so sánh được tối đa 3 chuyến cùng lúc')
      return
    }
    toggleCompare(trip.tripId)
    toast.success(inCompare ? 'Đã bỏ khỏi danh sách so sánh' : 'Đã thêm vào danh sách so sánh')
  }

  const handleBrandClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    navigate({ to: '/brands/$slug', params: { slug: trip.brandSlug } })
  }

  const handlePriceAlert = (e: React.MouseEvent) => {
    e.stopPropagation()
    setPriceAlertContext({
      fromName: trip.fromName,
      toName: trip.toName,
      minPrice: trip.minPrice,
    })
    setPriceAlertOpen(true)
  }

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation()
    setShareTripData({
      tripId: trip.tripId,
      fromName: trip.fromName,
      toName: trip.toName,
      departureAt: trip.departureAt ?? undefined,
      departureTime: trip.departureTime ?? undefined,
      brandName: trip.brandName,
      brandAccent: trip.brandAccent,
      brandRating: trip.brandRating,
      minPrice: trip.minPrice,
      vehicleTypeLabel: trip.vehicleTypeLabel,
    })
    setShareOpen(true)
  }

  return (
    <div onMouseEnter={handleHoverPrefetch}>
      <Card
        className="overflow-visible border-border/60   hover:border-primary/30 card-hover-lift group relative"
      >
        {/* Recommended badge — sits flush on the top-left, above content */}
        {isRecommended && (
          <div className="absolute -top-2 left-3 z-20">
            <Badge className="bg-amber-500 text-white gap-1 text-[10px] font-bold  hover:bg-amber-500">
              <Sparkles className="h-3 w-3" />
              Phù hợp nhất
            </Badge>
          </div>
        )}

        {/* Quick action buttons (top-right) */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-1">
          <button
            onClick={handleCompareToggle}
            title="Thêm vào so sánh"
            className={`h-7 w-7 rounded-full inline-flex items-center justify-center transition-all ${inCompare
              ? 'bg-violet-600 text-white '
              : 'bg-slate-50 text-slate-500 hover:bg-violet-50 hover:text-violet-600 ring-1 ring-slate-200 '
              }`}
          >
            <GitCompare className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={handleShare}
            title="Chia sẻ chuyến"
            className="h-7 w-7 rounded-full inline-flex items-center justify-center bg-slate-50 text-slate-500 hover:bg-blue-50 hover:text-blue-600 ring-1 ring-slate-200 transition-all"
          >
            <Share2 className="h-3.5 w-3.5" />
          </button>
          <WishlistButton
            variant="icon"
            presetLabel={`${trip.fromName} → ${trip.toName}`}
            presetRouteId={trip.routeId}
            presetBrandId={trip.brandId ?? undefined}
          />
        </div>

        <div className="flex flex-col md:flex-row">
          <TripCardBrand trip={trip} onBrandClick={handleBrandClick} />

          {/* Main content */}
          <div className="flex-1 p-3 md:p-3.5 min-w-0">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-5">
              {/* Time + route — fixed min widths so times never clip */}
              <div className="flex items-center gap-2 md:gap-3 min-w-0 flex-1">
                <div className="text-center shrink-0 min-w-15">
                  <div className="text-xl md:text-2xl font-bold leading-tight tabular-nums text-slate-900 group-hover:text-blue-700 transition-colors">{trip.departureTime}</div>
                  {showDepartureDate && (
                    <div className="text-[10px] text-blue-600 font-medium">{departureDateShort}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-22.5 mx-auto">{trip.fromName}</div>
                </div>

                <div className="flex-1 min-w-12.5 md:min-w-17.5 max-w-32.5 relative">
                  <div className="border-t border-dashed border-slate-300 group-hover:border-blue-400 transition-colors" />
                  {overnight && (
                    <div className="absolute inset-0 flex items-center justify-center">
                      <div className="bg-white px-1.5 text-[10px] text-amber-500 font-semibold whitespace-nowrap">
                        +1 ngày
                      </div>
                    </div>
                  )}
                </div>

                <div className="text-center shrink-0 min-w-15">
                  <div className="text-xl md:text-2xl font-bold leading-tight tabular-nums text-slate-900 group-hover:text-blue-700 transition-colors">{trip.arrivalAt ? formatTimeVN(trip.arrivalAt) : '—'}</div>
                  {showArrivalDate && (
                    <div className="text-[10px] text-blue-600 font-medium">{arrivalDateShort}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-22.5 mx-auto">{trip.toName}</div>
                </div>
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
