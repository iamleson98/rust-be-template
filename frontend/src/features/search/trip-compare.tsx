'use client'

import { memo, useEffect, useMemo, useState } from 'react'
import { useApp, type TripResult } from '@/lib/store'
import { useT, translate } from '@/lib/i18n'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { tripDetail } from '@/lib/api'
import type { TripDetail as TripDetailOut } from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'
import {
  X,
  GitCompare,
  Star,
  Clock,
  Wallet,
  Users,
  Bus,
  CheckCircle2,
  Sparkles,
  Loader2,
} from 'lucide-react'
import { formatVND, VEHICLE_TYPE_LABELS, formatTimeVN } from '@/lib/types'

/** Map a `GET /api/trips/{id}` detail response onto the search-result
 *  row shape the compare table renders. */
function detailToResult(d: TripDetailOut): TripResult {
  return {
    tripId: d.trip.id,
    amenities: (d.amenities ?? []).map((a) => a.label),
    arrivalAt: d.trip.arrivalAt ?? undefined,
    availableSeats: d.trip.availableSeats,
    brandAccent: d.brand.accentColor ?? '#2563eb',
    brandId: d.brand.id ?? undefined,
    brandName: d.brand.name ?? '',
    brandRating: d.brand.rating,
    brandSlug: d.brand.slug ?? '',
    busLayoutId: d.busLayout.id,
    capacity: d.busLayout.capacity ?? undefined,
    departureAt: d.trip.departureAt ?? undefined,
    departureDate: d.trip.departureDate,
    departureTime: d.trip.departureTime ?? undefined,
    fromLat: d.from.lat,
    fromLon: d.from.lon,
    fromName: d.from.name,
    maxPrice: d.pricing.basePriceAdult,
    minPrice: d.pricing.basePriceAdult,
    priceAdult: d.pricing.basePriceAdult,
    priceChild: d.pricing.basePriceChild,
    routeId: d.route.id,
    routeName: d.route.name,
    scheduleId: d.trip.id,
    toLat: d.to.lat,
    toLon: d.to.lon,
    toName: d.to.name,
    totalSeats: d.trip.totalSeats,
    vehicleType: d.busLayout.vehicleType ?? 'standard',
  } as unknown as TripResult
}

type CompareRow = {
  labelKey: string
  icon: React.ReactNode
  render: (t: TripResult) => React.ReactNode
  highlight?: (t: TripResult, all: TripResult[]) => boolean
  sortValue?: (t: TripResult) => number // lower = better
}

// Rows are static config — declared at module scope to avoid recreating
// the array (and its inline closures) on every render.
const COMPARE_ROWS: CompareRow[] = [
  {
    labelKey: 'searchPage.departureTime',
    icon: <Clock className="h-3.5 w-3.5" />,
    render: (t) => (
      <div className="text-center">
        <div className="font-mono text-base font-bold">{formatTimeVN(t.departureAt ?? '')}</div>
        <div className="text-[10px] text-muted-foreground">{t.fromName}</div>
      </div>
    ),
    sortValue: (t) => new Date(t.departureAt ?? '').getTime(),
  },
  {
    labelKey: 'searchPage.arrivalTime',
    icon: <Bus className="h-3.5 w-3.5" />,
    render: (t) => (
      <div className="text-center">
        <div className="font-mono text-base font-bold">{formatTimeVN(t.arrivalAt ?? '')}</div>
        <div className="text-[10px] text-muted-foreground">{t.toName}</div>
      </div>
    ),
  },
  {
    labelKey: 'searchPage.vehicleType',
    icon: <Bus className="h-3.5 w-3.5" />,
    render: (tr) => (
      <Badge variant="outline" className="font-normal">
        {translate(useApp.getState().lang, VEHICLE_TYPE_LABELS[tr.vehicleType] ?? tr.vehicleType)}
      </Badge>
    ),
  },
  {
    labelKey: 'searchPage.availableSeats',
    icon: <Users className="h-3.5 w-3.5" />,
    render: (t) => (
      <span className={t.availableSeats <= 3 ? 'text-rose-600 font-semibold' : 'font-medium'}>
        {t.availableSeats}/{t.totalSeats}
      </span>
    ),
    sortValue: (t) => -t.availableSeats,
  },
  {
    labelKey: 'searchPage.rating',
    icon: <Star className="h-3.5 w-3.5" />,
    render: (t) => (
      <span className="inline-flex items-center gap-1">
        <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
        <span className="font-medium">{t.brandRating.toFixed(1)}</span>
      </span>
    ),
    sortValue: (t) => -t.brandRating,
  },
  {
    labelKey: 'common.fromPrice',
    icon: <Wallet className="h-3.5 w-3.5" />,
    render: (t) => (
      <span className="font-extrabold text-blue-700 text-lg">{formatVND(t.minPrice)}</span>
    ),
    sortValue: (t) => t.minPrice,
  },
  {
    labelKey: 'searchPage.comforts',
    icon: <Sparkles className="h-3.5 w-3.5" />,
    render: (t) => (
      <div className="flex flex-wrap gap-1 justify-center">
        {t.amenities.slice(0, 4).map((a) => (
          <Badge key={a} variant="outline" className="text-[10px] font-normal px-1 py-0">
            {a}
          </Badge>
        ))}
      </div>
    ),
  },
]

export const TripCompare = memo(function TripCompare({ inline = false }: { inline?: boolean }) {
  const { compareList, compareOpen, setCompareOpen, toggleCompare, clearCompare } = useApp()
  const navigate = useNavigate()
  const t = useT()
  const [trips, setTrips] = useState<TripResult[]>([])
  const [loading, setLoading] = useState(false)

  // `inline` = the standalone `/compare` page. The overlay mode is gated
  // by `compareOpen`; the page mode is always open (it previously
  // rendered a permanently blank screen after a reload / deep link).
  const open = inline || compareOpen

  useEffect(() => {
    let cancelled = false
    if (compareList.length === 0) {
      setTrips([])
      return
    }
    setLoading(true)
    Promise.all(
      compareList.map(async (tripId) => {
        // Search results (still on the same session) are preferred —
        // they are already in memory; otherwise fetch the trip
        // detail so a reload / deep link still produces a full table
        // (previously the table rendered zero columns).
        const cached = window.__lastSearchResults as TripResult[] | undefined
        const fromCache = cached?.find((tr) => tr.tripId === tripId)
        if (fromCache) return fromCache
        try {
          const res = await tripDetail({ path: { id: tripId } })
          if (res.data) return detailToResult(res.data as unknown as TripDetailOut)
        } catch {
          /* failed fetch → filtered out below */
        }
        return null
      }),
    )
      .then((rows) => {
        if (cancelled) return
        setTrips(rows.filter(Boolean) as TripResult[])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [compareList])

  // Memoize the "best tripId" per row so we don't re-sort on every render.
  const bestIdsByRow = useMemo(() => {
    return COMPARE_ROWS.map((row) => {
      if (!row.sortValue || trips.length === 0) return null
      let best = trips[0]
      let bestVal = row.sortValue(best)
      for (let i = 1; i < trips.length; i++) {
        const v = row.sortValue(trips[i])
        if (v < bestVal) {
          best = trips[i]
          bestVal = v
        }
      }
      return best.tripId
    })
  }, [trips])

  const getBest = (rowIndex: number) => bestIdsByRow[rowIndex]

  return (
    <>
      {open && (
        <>
          {!inline && (
            <div
              className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
              onClick={() => setCompareOpen(false)}
            />
          )}
          <div
            className={cn(
              'bg-background flex flex-col overflow-hidden ring-1 ring-black/10 dark:ring-white/10',
              inline
                ? 'relative w-full max-w-5xl mx-auto rounded-2xl max-h-[85dvh]'
                : 'fixed inset-0 z-50 sm:inset-x-4 sm:top-8 sm:bottom-8 sm:m-auto sm:max-w-5xl sm:rounded-2xl',
            )}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-b bg-linear-to-r from-violet-600 to-fuchsia-600 text-white">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-full bg-white/15 inline-flex items-center justify-center">
                  <GitCompare className="h-4 w-4" />
                </div>
                <div>
                  <div className="font-semibold text-sm">{t('searchPage.compareTrips')}</div>
                  <div className="text-[10px] text-white/80">
                    {t('searchPage.compareSubtitle', { count: trips.length })}
                  </div>
                </div>
              </div>
              <button
                onClick={() => setCompareOpen(false)}
                className="h-8 w-8 inline-flex items-center justify-center rounded-md hover:bg-white/15"
                aria-label={t('common.close')}
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
                </div>
              ) : compareList.length === 0 ? (
                <div className="p-12 text-center">
                  <div className="inline-flex h-14 w-14 rounded-full bg-muted items-center justify-center mb-3">
                    <GitCompare className="h-7 w-7 text-muted-foreground" />
                  </div>
                  <h3 className="font-semibold mb-1">{t('searchPage.compareEmptyTitle')}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t('searchPage.compareEmptyDesc')}
                  </p>
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/50">
                        <th className="sticky left-0 z-10 bg-muted/50 px-4 sm:px-6 py-3 text-left w-32 sm:w-40">
                          <span className="text-xs font-semibold uppercase text-muted-foreground">
                            {t('searchPage.criteria')}
                          </span>
                        </th>
                        {trips.map((tr) => (
                          <th key={tr.tripId} className="px-3 sm:px-4 py-3 align-top min-w-45">
                            <div className="space-y-1.5">
                              <div className="flex items-start justify-between gap-2">
                                <div className="font-bold text-base leading-tight">
                                  {tr.brandName}
                                </div>
                                <button
                                  onClick={() => toggleCompare(tr.tripId)}
                                  className="text-muted-foreground hover:text-rose-600"
                                  aria-label={t('searchPage.removeFromCompare')}
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {tr.fromName} → {tr.toName}
                              </div>
                              <Badge
                                variant="outline"
                                className="text-[10px] font-normal"
                                style={{ borderColor: tr.brandAccent, color: tr.brandAccent }}
                              >
                                {translate(
                                  useApp.getState().lang,
                                  VEHICLE_TYPE_LABELS[tr.vehicleType] ?? tr.vehicleType,
                                )}
                              </Badge>
                            </div>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {COMPARE_ROWS.map((row, idx) => {
                        const bestId = getBest(idx)
                        return (
                          <tr
                            key={idx}
                            className="border-b last:border-b-0 hover:bg-muted/40 transition-colors"
                          >
                            <td className="sticky left-0 z-10 bg-background px-4 sm:px-6 py-3 text-xs text-muted-foreground">
                              <div className="flex items-center gap-1.5">
                                {row.icon}
                                {t(row.labelKey)}
                              </div>
                            </td>
                            {trips.map((tr) => {
                              const isBest = bestId === tr.tripId
                              return (
                                <td
                                  key={tr.tripId}
                                  className={`px-3 sm:px-4 py-3 text-center ${
                                    isBest ? 'bg-blue-50/60 dark:bg-blue-950/30' : ''
                                  }`}
                                >
                                  <div className="relative inline-flex flex-col items-center">
                                    {row.render(tr)}
                                    {isBest && (
                                      <span
                                        className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-blue-500 text-white inline-flex items-center justify-center"
                                        title={t('searchPage.best')}
                                      >
                                        <CheckCircle2 className="h-3 w-3" />
                                      </span>
                                    )}
                                  </div>
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                      <tr>
                        <td className="sticky left-0 z-10 bg-white px-4 sm:px-6 py-3" />
                        {trips.map((tr) => (
                          <td key={tr.tripId} className="px-3 sm:px-4 py-3 text-center">
                            <Button
                              size="sm"
                              className="gap-1.5 bg-linear-to-r from-blue-600 to-blue-600 hover:from-blue-700 hover:to-blue-700"
                              onClick={() => {
                                navigate({ to: '/trips/$tripId', params: { tripId: tr.tripId } })
                                setCompareOpen(false)
                              }}
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {t('searchPage.selectTrip')}
                            </Button>
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="border-t px-4 sm:px-6 py-2 flex items-center justify-between bg-slate-50">
              <Button
                variant="ghost"
                size="sm"
                onClick={clearCompare}
                disabled={trips.length === 0}
              >
                {t('searchPage.clearAll')}
              </Button>
              <div className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                <Sparkles className="h-3 w-3 text-blue-500" />
                {t('searchPage.compareFooterNote')}
              </div>
            </div>
          </div>
        </>
      )}
    </>
  )
})
