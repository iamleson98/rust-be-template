import { memo, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { ChevronRight, Droplet, GitCompare, Share2, Snowflake, Star, Wifi, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { tripDetailOptions, type TripResult } from '@/api'
import { formatCurrency, formatDuration, formatTimeVN, parseDateSafe } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { AMENITY_LABELS } from '@/lib/labels'
import { cn } from '@/lib/utils'
import { useGuest } from '@/stores/guest'
import { usePrefs } from '@/stores/prefs'
import { useUi } from '@/stores/ui'

const AMENITY_ICON: Record<string, typeof Wifi> = {
  wifi: Wifi,
  ac: Snowflake,
  water: Droplet,
  charging: Zap,
}

const DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' })

/** Calendar days between departure and arrival in Vietnam (0 when unknown). */
function daysLater(departureAt?: string | null, arrivalAt?: string | null): number {
  const dep = parseDateSafe(departureAt)
  const arr = parseDateSafe(arrivalAt)
  if (!dep || !arr) return 0
  return Math.round((Date.parse(DAY.format(arr)) - Date.parse(DAY.format(dep))) / 86_400_000)
}

/** Minutes on the road, when the schedule gives an arrival time. */
function minutesBetween(departureAt?: string | null, arrivalAt?: string | null) {
  const dep = parseDateSafe(departureAt)
  const arr = parseDateSafe(arrivalAt)
  return dep && arr && arr > dep ? Math.round((arr.getTime() - dep.getTime()) / 60_000) : null
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

/**
 * One search result. The times and the journey lead (what people compare
 * first), then the operator, then price and the way in. Every number is the
 * API's: no "original" prices, no invented urgency — "almost full" means at
 * most three seats left, "cheapest" means the lowest fare in these results.
 */
export const TripCard = memo(function TripCard({
  trip,
  onSelect,
  cheapest = false,
}: {
  trip: TripResult
  onSelect?: () => void
  /** The lowest fare among the results on screen. */
  cheapest?: boolean
}) {
  const t = useT()
  const currency = usePrefs((s) => s.currency)
  const toggleCompare = useUi((s) => s.toggleCompare)
  const compareCount = useUi((s) => s.compareList.length)
  const inCompare = useUi((s) => s.compareList.includes(trip.tripId))
  const openShare = useUi((s) => s.openShare)
  const pushRecentlyViewed = useGuest((s) => s.pushRecentlyViewed)
  const queryClient = useQueryClient()

  // Warm the detail query on hover: the trip dialog reads the same cache.
  const prefetch = useCallback(() => {
    void queryClient.prefetchQuery({
      ...tripDetailOptions({ path: { id: trip.tripId } }),
      staleTime: 60_000,
    })
  }, [queryClient, trip.tripId])

  const select = () => {
    pushRecentlyViewed({
      tripId: trip.tripId,
      routeId: trip.routeId,
      label: `${trip.fromName} → ${trip.toName}`,
      brandName: trip.brandName,
    })
    onSelect?.()
  }

  const compare = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!inCompare && compareCount >= 3) {
      toast.info(t('searchPage.compareMax'))
      return
    }
    toggleCompare(trip.tripId)
    toast.success(inCompare ? t('searchPage.compareRemoved') : t('searchPage.compareAdded'))
  }

  const share = (e: React.MouseEvent) => {
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

  const minutes = minutesBetween(trip.departureAt, trip.arrivalAt)
  const plusDays = daysLater(trip.departureAt, trip.arrivalAt)
  const fewSeats = trip.availableSeats > 0 && trip.availableSeats <= 5
  const almostFull = trip.availableSeats > 0 && trip.availableSeats <= 3

  const quickActions = (
    <div className="flex shrink-0 items-center gap-1">
      <button
        onClick={compare}
        title={t('searchPage.addToCompare')}
        aria-label={t('searchPage.addToCompare')}
        aria-pressed={inCompare}
        className={cn(
          'grid size-8 place-items-center rounded-full transition-colors',
          inCompare
            ? 'bg-violet-600 text-white'
            : 'text-slate-400 hover:bg-violet-50 hover:text-violet-600',
        )}
      >
        <GitCompare className="size-4" />
      </button>
      <button
        onClick={share}
        title={t('searchPage.shareTrip')}
        aria-label={t('searchPage.shareTrip')}
        className="grid size-8 place-items-center rounded-full text-slate-400 transition-colors hover:bg-primary/10 hover:text-primary"
      >
        <Share2 className="size-4" />
      </button>
    </div>
  )

  return (
    <article
      data-testid="trip-card"
      onMouseEnter={prefetch}
      onClick={select}
      className="group relative cursor-pointer rounded-2xl bg-white shadow-soft ring-1 ring-slate-200/80 transition duration-200 hover:shadow-float hover:ring-primary/35"
    >
      <div className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-0 sm:p-0">
        <div className="min-w-0 sm:p-5">
          {/* Operator */}
          <div className="flex items-center gap-2.5">
            <span
              className="grid size-9 shrink-0 place-items-center rounded-xl text-xs font-bold text-white"
              style={{ background: trip.brandAccent }}
            >
              {initials(trip.brandName)}
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to="/brands/$slug"
                params={{ slug: trip.brandSlug }}
                onClick={(e) => e.stopPropagation()}
                className="block truncate text-sm font-semibold text-slate-900 hover:text-primary"
                title={t('searchPage.viewBrandDetails', { name: trip.brandName })}
              >
                {trip.brandName}
              </Link>
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                {trip.brandRating != null && (
                  <>
                    <span className="inline-flex items-center gap-0.5 font-medium text-slate-700">
                      <Star className="size-3 fill-amber-400 text-amber-400" />
                      {trip.brandRating.toFixed(1)}
                    </span>
                    <span aria-hidden>·</span>
                  </>
                )}
                <span className="truncate">{trip.vehicleTypeLabel}</span>
              </div>
            </div>
            {quickActions}
          </div>

          {/* Journey */}
          <div className="mt-4 grid grid-cols-[auto_minmax(2.5rem,1fr)_auto] items-center gap-x-3">
            <div className="text-[1.375rem] leading-none font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">
              {trip.departureTime}
            </div>
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-400">
              <span className="size-1.5 shrink-0 rounded-full border border-slate-300" />
              <span className="h-px flex-1 border-t border-dashed border-slate-300" />
              {minutes != null && (
                <span className="shrink-0 text-slate-500">{formatDuration(minutes)}</span>
              )}
              {minutes != null && (
                <span className="h-px flex-1 border-t border-dashed border-slate-300" />
              )}
              <span className="size-1.5 shrink-0 rounded-full bg-slate-300" />
            </div>
            <div className="text-right text-[1.375rem] leading-none font-bold tracking-tight text-slate-900 tabular-nums sm:text-2xl">
              {trip.arrivalAt ? (
                <>
                  {formatTimeVN(trip.arrivalAt)}
                  {plusDays > 0 && (
                    <sup className="ml-0.5 text-[10px] font-semibold text-amber-600">
                      +{plusDays}
                    </sup>
                  )}
                </>
              ) : (
                // No arrival time on this schedule: the destination takes the slot.
                <span className="block max-w-32 truncate text-base font-semibold text-slate-900">
                  {trip.toName}
                </span>
              )}
            </div>
            <div className="mt-1.5 truncate text-xs text-slate-500">{trip.fromName}</div>
            <div />
            <div className="mt-1.5 truncate text-right text-xs text-slate-500">
              {trip.arrivalAt ? trip.toName : t('searchPage.viewArrival')}
            </div>
          </div>

          {/* Comfort */}
          {trip.amenities.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              {trip.amenities.slice(0, 4).map((a) => {
                const Icon = AMENITY_ICON[a]
                return (
                  <span
                    key={a}
                    className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600"
                  >
                    {Icon && <Icon className="size-3" />}
                    {t(AMENITY_LABELS[a] ?? a)}
                  </span>
                )
              })}
              {trip.amenities.length > 4 && (
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
                  +{trip.amenities.length - 4}
                </span>
              )}
            </div>
          )}
        </div>

        {/* Fare and the way in */}
        <div className="flex items-center justify-between gap-3 border-t border-slate-100 pt-4 sm:w-48 sm:flex-col sm:items-end sm:justify-center sm:border-t-0 sm:border-l sm:p-5 md:w-52">
          <div className="min-w-0 sm:text-right">
            <div className="flex flex-wrap gap-1 sm:justify-end">
              {cheapest && (
                <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                  {t('searchPage.cheapest')}
                </span>
              )}
              {almostFull && (
                <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-semibold text-rose-600">
                  {t('searchPage.almostFull')}
                </span>
              )}
            </div>
            <div className="mt-1 text-xl font-extrabold tracking-tight whitespace-nowrap text-slate-900 tabular-nums sm:text-2xl">
              {trip.maxPrice > trip.minPrice && (
                <span className="mr-1 text-xs font-medium text-slate-500">
                  {t('home.priceFrom')}
                </span>
              )}
              {formatCurrency(trip.minPrice, currency)}
            </div>
            <div
              className={cn('text-xs', fewSeats ? 'font-semibold text-rose-600' : 'text-slate-500')}
            >
              {fewSeats
                ? t('searchPage.onlySeatsLeft', { count: trip.availableSeats })
                : `${trip.availableSeats} ${t('common.seatsAvailable')}`}
            </div>
          </div>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              select()
            }}
            className="inline-flex h-10 shrink-0 items-center gap-1 rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 sm:mt-3 sm:w-full sm:justify-center"
          >
            {t('searchPage.selectTrip')}
            <ChevronRight className="size-4 transition-transform group-hover:translate-x-0.5" />
          </button>
        </div>
      </div>
    </article>
  )
})
