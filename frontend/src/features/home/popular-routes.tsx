'use client'

import { usePrefs } from '@/stores/prefs'
import { useSearchForm } from '@/stores/search-form'
import { memo, useCallback } from 'react'
import { useNavigate } from '@tanstack/react-router'
import type { RouteOut } from '@/api'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { searchTripsOptions, routesOptions } from '@/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ErrorState } from '@/components/error-state'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { ArrowRight, Star, Bus, ChevronRight } from 'lucide-react'
import { PopularRoutesSkeleton } from '@/features/home/components/popular-routes-skeleton'
import { buildSearchInput } from '@/lib/search-params'

export const PopularRoutes = memo(function PopularRoutes() {
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  const currency = usePrefs((s) => s.currency)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const t = useT()

  // ── Data: TanStack Query ─────────────────────────────────────────
  // Replaces the bespoke `useEffect + fetch + useState` pattern with
  // a cached, deduped, retryable query shared app-wide via `queryKeys.routes`.
  const { data, isLoading, isError, refetch } = useQuery(routesOptions())
  const items: RouteOut[] = data?.items ?? []

  // Navigate to /search with the route's from/to prefilled. Replaces the
  // old `setSearchLoading + setView('results') + fetch + setSearchResults`
  // pattern — the /search route now owns the fetch via useTripSearch.
  const quickSearch = useCallback(
    (from: string, to: string) => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const date = tomorrow.toISOString().slice(0, 10)
      setSearchParams({ from, to, date })
      navigate({
        to: '/search',
        search: buildSearchInput({ from, to, date }),
      })
    },
    [setSearchParams, navigate],
  )

  // Prefetch search results on hover so clicking feels instant. Uses
  // the SAME options object (hence query key) as useTripSearch — the
  // previous bespoke key (queryKeys.trips.search) never matched the
  // hook's generated key, so every "prefetch" was a wasted request.
  const handleHoverPrefetch = useCallback(
    (from: string, to: string) => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const date = tomorrow.toISOString().slice(0, 10)
      queryClient.prefetchQuery(
        searchTripsOptions({ query: { from, to, date, sort: 'departure', minSeats: 1 } }),
      )
    },
    [queryClient],
  )

  // group by from-to pair, take unique routes
  const seen = new Set<string>()
  const unique = items
    .filter((r) => {
      const key = `${r.from.name}->${r.to.name}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 8)

  return (
    <section className="bg-white">
      <div className="container mx-auto px-4 py-12 md:py-16">
        {isLoading ? (
          <PopularRoutesSkeleton count={8} />
        ) : isError ? (
          <ErrorState description={t('home.popularRoutesError')} onRetry={() => refetch()} />
        ) : (
          <>
            <div>
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">
                    {t('home.popularRoutesTitle')}
                  </h2>
                  <p className="text-muted-foreground mt-1 text-sm">
                    {t('home.popularRoutesSubtitle')}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {unique.map((r) => (
                <button
                  key={r.id}
                  onClick={() => quickSearch(r.from.name, r.to.name)}
                  onMouseEnter={() => handleHoverPrefetch(r.from.name, r.to.name)}
                  className="group text-left"
                >
                  <Card className="group overflow-hidden border-border/60 hover:border-blue-400 hover:-translate-y-1 transition-all duration-300 h-full">
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{
                            background: `${r.brand.accentColor ?? '#64748b'}15`,
                            color: r.brand.accentColor ?? '#64748b',
                          }}
                        >
                          <Bus className="h-3 w-3" />
                          {r.brand.name ?? '—'}
                        </span>
                        {r.brand.rating != null && (
                          <div className="flex items-center gap-1 text-xs text-amber-500">
                            <Star className="h-3 w-3 fill-current" />
                            {r.brand.rating.toFixed(1)}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-base truncate">{r.from.name}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {t('search.from')}
                          </div>
                        </div>
                        <div className="shrink-0 h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                          <ArrowRight className="h-4 w-4 text-blue-600 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                        <div className="min-w-0 flex-1 text-right">
                          <div className="font-bold text-base truncate">{r.to.name}</div>
                          <div className="text-[11px] text-muted-foreground">{t('search.to')}</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                        <span className="font-medium text-blue-600">
                          {t('home.tripsPerDay', { count: r.scheduleCount })}
                        </span>
                      </div>

                      {/* REAL price — lowest schedule price from the API.
                          No price is shown when a route has no schedules
                          yet (never a made-up number). */}
                      {r.priceFrom != null ? (
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-blue-700">
                            {t('home.priceFrom')} {formatCurrency(r.priceFrom, currency)}
                          </span>
                          <span className="text-[10px] text-amber-500 font-medium">
                            {t('home.popularBadge')}
                          </span>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          {t('searchPage.noSchedulesYet')}
                        </div>
                      )}
                    </div>
                  </Card>
                </button>
              ))}
            </div>

            {/* View all routes button */}
            <div className="mt-6 flex justify-center">
              <Button
                variant="outline"
                className="gap-2 border-blue-300 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600 transition-colors"
                onClick={() => {
                  const tomorrow = new Date()
                  tomorrow.setDate(tomorrow.getDate() + 1)
                  const date = tomorrow.toISOString().slice(0, 10)
                  setSearchParams({ from: '', to: '', date })
                  navigate({
                    to: '/search',
                    search: buildSearchInput({ from: '', to: '', date }),
                  })
                }}
              >
                {t('home.viewAllRoutes')}
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
})
