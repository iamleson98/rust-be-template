'use client'

import { memo, useCallback } from 'react'
import type { TripResult } from '@/lib/store'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { formatDuration, formatTimeVN, AMENITY_LABELS, VEHICLE_TYPE_ICONS } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import { Clock, MapPin, Users, Star, Wifi, Snowflake, Droplet, Zap, ChevronRight, TrendingUp, TrendingDown, Minus, GitCompare, Sparkles, Bell, Share2 } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { useApp } from '@/lib/store'
import { useShallow } from 'zustand/react/shallow'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'
import { useNavigate } from '@/router'
import { WishlistButton } from './wishlist-button'
import { toast } from 'sonner'

const amenityIcon: Record<string, React.ReactNode> = {
  wifi: <Wifi className="h-3.5 w-3.5" />,
  ac: <Snowflake className="h-3.5 w-3.5" />,
  water: <Droplet className="h-3.5 w-3.5" />,
  charging: <Zap className="h-3.5 w-3.5" />,
}

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

/** Format review count compactly e.g. 1200 -> "1.2k" */
function formatReviewCount(count: number): string {
  if (count >= 1000) {
    const val = count / 1000
    return val >= 10 ? `${Math.round(val)}k` : `${val.toFixed(1)}k`
  }
  return String(count)
}

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
    queryClient.prefetchQuery({
      queryKey: queryKeys.trips.detail(trip.tripId),
      queryFn: async () => {
        // Backend route: `GET /api/trips/{id}`. Send credentials so the
        // httpOnly JWT cookie is attached (although the endpoint is public,
        // authed users may get richer data).
        const res = await fetch(`/api/trips/${trip.tripId}`, { credentials: 'include' })
        if (!res.ok) throw new Error('Failed to prefetch trip')
        return res.json()
      },
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

  // Price calculations
  const originalPrice = Math.round(trip.minPrice * 1.15)
  const hasPriceRange = trip.maxPrice > trip.minPrice

  // Vehicle type emoji
  const vehicleEmoji = VEHICLE_TYPE_ICONS[trip.vehicleType] ?? '🚌'

  // Review count (deterministic from brandRating to avoid random per-render)
  const reviewCount = Math.floor(trip.brandRating * 250 + (trip.brandName.length * 17) % 100)

  // Amenities overflow
  const maxVisibleAmenities = 4
  const overflowCount = Math.max(0, trip.amenities.length - maxVisibleAmenities)

  // Seat availability percentage
  const seatAvailPct = trip.totalSeats > 0 ? (trip.availableSeats / trip.totalSeats) * 100 : 100
  const availBarColor = seatAvailPct > 50 ? 'bg-blue-500' : seatAvailPct > 20 ? 'bg-amber-500' : 'bg-rose-500'

  // Price trend
  const priceTrend = getPriceTrend(trip.tripId)
  const trendCfg = TREND_CONFIG[priceTrend]
  const TrendIcon = trendCfg.icon

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
        className="overflow-visible border-border/60 shadow-sm hover:shadow-md hover:border-slate-300 transition-[border-color,box-shadow] duration-300 group relative"
      >
        {/* Recommended badge — sits flush on the top-left, above content */}
        {isRecommended && (
          <div className="absolute -top-2 left-3 z-20">
            <Badge className="bg-amber-500 text-white gap-1 text-[10px] font-bold shadow-sm hover:bg-amber-500">
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
          {/* Brand block — compact, balanced */}
          <div className="md:w-40 shrink-0 bg-slate-50/60 p-3 md:p-3.5 md:border-r border-border/50 flex flex-row md:flex-col items-center md:items-start gap-3 md:gap-2">
            <div
              className="h-11 w-11 rounded-lg flex items-center justify-center text-white font-bold text-sm shrink-0 ring-1 ring-black/5"
              style={{ background: trip.brandAccent }}
            >
              {trip.brandName.split(' ').map((w) => w[0]).join('').slice(0, 2)}
            </div>
            <div className="min-w-0">
              <button
                onClick={handleBrandClick}
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
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="bg-white px-1.5 text-[10px] text-muted-foreground flex items-center gap-1 whitespace-nowrap group-hover:text-blue-600 transition-colors">
                      <Clock className="h-3 w-3" />
                      {formatDuration(trip.durationMin)}
                      {overnight && <span className="text-amber-500 font-semibold">+1</span>}
                    </div>
                  </div>
                </div>

                <div className="text-center shrink-0 min-w-15">
                  <div className="text-xl md:text-2xl font-bold leading-tight tabular-nums text-slate-900 group-hover:text-blue-700 transition-colors">{trip.arrivalAt ? formatTimeVN(trip.arrivalAt) : '—'}</div>
                  {showArrivalDate && (
                    <div className="text-[10px] text-blue-600 font-medium">{arrivalDateShort}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-0.5 truncate max-w-22.5 mx-auto">{trip.toName}</div>
                </div>
              </div>

              {/* Amenities + seats (desktop) */}
              <div className="hidden lg:flex flex-col items-end gap-1.5 shrink-0">
                <div className="flex items-center gap-1">
                  {trip.amenities.slice(0, maxVisibleAmenities).map((a) => (
                    <span
                      key={a}
                      title={AMENITY_LABELS[a] ?? a}
                      className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors"
                    >
                      {amenityIcon[a] ?? <MapPin className="h-3 w-3" />}
                    </span>
                  ))}
                  {overflowCount > 0 && (
                    <span className="h-6 px-1.5 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-muted-foreground group-hover:bg-blue-50 transition-colors">
                      +{overflowCount}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1 text-xs">
                  <Users className="h-3.5 w-3.5 text-slate-400" />
                  {lowSeats ? (
                    <span className="text-rose-600 font-semibold flex items-center gap-1">
                      {sellingFast && <TrendingUp className="h-3 w-3" />}
                      Chỉ còn {trip.availableSeats} chỗ
                    </span>
                  ) : (
                    <span className="text-muted-foreground">{trip.availableSeats} chỗ trống</span>
                  )}
                </div>
                {/* Seat availability bar (desktop) — slim, muted */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div className="w-full max-w-30 h-1 rounded-full bg-slate-200 overflow-hidden cursor-default">
                      <div
                        className={`h-full rounded-full ${availBarColor} transition-all duration-500`}
                        style={{ width: `${seatAvailPct}%` }}
                      />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom">
                    {trip.availableSeats}/{trip.totalSeats} ghế trống ({Math.round(seatAvailPct)}%)
                  </TooltipContent>
                </Tooltip>
              </div>
            </div>

            {/* Mobile amenities - icon only badges */}
            <div className="lg:hidden mt-2.5 flex items-center gap-1.5 flex-wrap">
              {trip.amenities.slice(0, maxVisibleAmenities).map((a) => (
                <span
                  key={a}
                  title={AMENITY_LABELS[a] ?? a}
                  className="h-6 w-6 rounded-md bg-slate-100 flex items-center justify-center text-slate-500 group-hover:bg-blue-50 group-hover:text-blue-600 transition-colors"
                >
                  {amenityIcon[a] ?? <MapPin className="h-3 w-3" />}
                </span>
              ))}
              {overflowCount > 0 && (
                <span className="h-6 px-1.5 rounded-md bg-slate-100 flex items-center justify-center text-[10px] text-muted-foreground group-hover:bg-blue-50 transition-colors">
                  +{overflowCount}
                </span>
              )}
              <span className="text-xs text-muted-foreground ml-auto flex items-center gap-1">
                <Users className="h-3 w-3" />
                {lowSeats ? (
                  <span className="text-rose-600 font-semibold flex items-center gap-1">
                    {sellingFast && <TrendingUp className="h-3 w-3" />}
                    Còn {trip.availableSeats} chỗ
                  </span>
                ) : (
                  <span>{trip.availableSeats} chỗ trống</span>
                )}
              </span>
            </div>

            {/* Mobile seat availability bar */}
            <div className="lg:hidden mt-1.5">
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="w-full h-1 rounded-full bg-slate-200 overflow-hidden cursor-default">
                    <div
                      className={`h-full rounded-full ${availBarColor} transition-all duration-500`}
                      style={{ width: `${seatAvailPct}%` }}
                    />
                  </div>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {trip.availableSeats}/{trip.totalSeats} ghế trống ({Math.round(seatAvailPct)}%)
                </TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Price + action — clean hierarchy: strikethrough first, then current price, then CTA.
              Wider column (md:w-56) so prices like "1.250.000₫" never overflow. */}
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
                onClick={handleSelect}
                size="sm"
                className="bg-slate-900 hover:bg-slate-800 text-white gap-1.5 transition-all w-full md:w-auto h-9 shadow-sm hover:shadow group-hover:bg-blue-600"
              >
                <span className="flex items-center gap-1">
                  Chọn chuyến
                  <ChevronRight className="h-4 w-4 group-hover:translate-x-0.5 transition-transform" />
                </span>
              </Button>
              {/* Price alert subscribe button — slim text link */}
              <button
                onClick={handlePriceAlert}
                className="w-full md:w-auto inline-flex items-center justify-center gap-1 text-[11px] font-medium text-slate-500 hover:text-blue-700 transition-colors py-0.5"
                title="Theo dõi khi giá giảm"
              >
                <Bell className="h-3 w-3" />
                Theo dõi giá
              </button>
            </div>
          </div>
        </div>
      </Card>
    </div>
  )
})

/* Skeleton loader for trip cards */
export const TripCardSkeleton = memo(function TripCardSkeleton() {
  return (
    <Card className="overflow-hidden border-border/60">
      <div className="flex flex-col md:flex-row">
        <div className="md:w-40 shrink-0 bg-slate-50/60 p-3.5 md:border-r border-border/50">
          <div className="flex flex-row md:flex-col items-center gap-3">
            <div className="h-11 w-11 rounded-lg bg-slate-200 shrink-0" />
            <div className="space-y-2 flex-1">
              <div className="h-4 bg-slate-200 rounded w-20" />
              <div className="h-3 bg-slate-200 rounded w-12" />
            </div>
          </div>
        </div>
        <div className="flex-1 p-4">
          <div className="flex items-center gap-3">
            <div className="space-y-2">
              <div className="h-7 bg-slate-200 rounded w-14" />
              <div className="h-3 bg-slate-200 rounded w-16" />
            </div>
            <div className="flex-1 h-0.5 bg-slate-200 rounded" />
            <div className="space-y-2">
              <div className="h-7 bg-slate-200 rounded w-14" />
              <div className="h-3 bg-slate-200 rounded w-16" />
            </div>
          </div>
          <div className="mt-3 flex gap-1.5">
            <div className="h-6 w-6 rounded-md bg-slate-200" />
            <div className="h-6 w-6 rounded-md bg-slate-200" />
            <div className="h-6 w-6 rounded-md bg-slate-200" />
          </div>
        </div>
        <div className="md:w-56 shrink-0 p-4 border-t md:border-t-0 md:border-l border-border/50 bg-slate-50/60">
          <div className="space-y-2 md:text-right">
            <div className="h-3 bg-slate-200 rounded w-8" />
            <div className="h-7 bg-slate-200 rounded w-24 ml-auto" />
            <div className="h-8 bg-slate-200 rounded-lg w-full mt-2" />
          </div>
        </div>
      </div>
    </Card>
  )
})
