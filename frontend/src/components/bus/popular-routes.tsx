'use client'

import { memo, useCallback } from 'react'
import { useApp } from '@/lib/store'
import { useNavigate } from '@/router'
import { usePopularRoutes, type RouteItem } from '@/lib/queries'
import { useQueryClient } from '@tanstack/react-query'
import { queryKeys } from '@/lib/query-client'
import { apiJson } from '@/lib/api-client'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ErrorState } from './empty-states'
import { formatDuration } from '@/lib/types'
import { formatCurrency } from '@/lib/currency'
import { ArrowRight, Clock, Star, MapPin, Bus, ChevronRight, TrendingUp } from 'lucide-react'
import { PopularRoutesSkeleton } from './skeletons'
import { buildSearchInput } from '@/lib/search-params'

export const PopularRoutes = memo(function PopularRoutes() {
  const { setSearchParams, currency } = useApp()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  // ── Data: TanStack Query ─────────────────────────────────────────
  // Replaces the bespoke `useEffect + fetch + useState` pattern with
  // a cached, deduped, retryable query shared app-wide via `queryKeys.routes`.
  const { data, isLoading, isError, refetch } = usePopularRoutes()
  const items: RouteItem[] = data?.items ?? []

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

  // Prefetch search results on hover so clicking feels instant.
  // Uses the same query key as `useTripSearch` so the cache is shared.
  const handleHoverPrefetch = useCallback(
    (from: string, to: string) => {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const date = tomorrow.toISOString().slice(0, 10)
      const params = { from, to, date, adults: 1, children: 0, sort: 'departure' as const }
      queryClient.prefetchQuery({
        queryKey: queryKeys.trips.search(params),
        queryFn: async () => {
          const sp = new URLSearchParams({ ...params, adults: '1', children: '0', sort: 'departure' })
          return apiJson(`/api/search?${sp}`)
        },
        staleTime: 30 * 1000,
      })
    },
    [queryClient],
  )

  // Deterministic price from route id hash
  const getPriceFromHash = (id: string): number => {
    let hash = 0
    for (let i = 0; i < id.length; i++) {
      hash = ((hash << 5) - hash + id.charCodeAt(i)) | 0
    }
    // Map hash to price range 150.000 - 850.000 in 25.000 increments
    const steps = Math.abs(hash) % 29 // 0-28
    return 150000 + steps * 25000
  }

  // group by from-to pair, take unique routes
  const seen = new Set<string>()
  const unique = items.filter((r) => {
    const key = `${r.from.name}->${r.to.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  }).slice(0, 8)

  // Max scheduleCount for popularity bar normalization
  const maxSchedules = Math.max(...unique.map((r) => r.scheduleCount), 1)

  return (
    <section className="bg-white">
      <div className="container mx-auto px-4 py-12 md:py-16">
        {isLoading ? (
          <PopularRoutesSkeleton count={8} />
        ) : isError ? (
          <ErrorState
            description="Không thể tải danh sách tuyến đường phổ biến. Vui lòng thử lại."
            onRetry={() => refetch()}
          />
        ) : (
          <>
            <div>
              <div className="flex items-end justify-between mb-6">
                <div>
                  <h2 className="text-2xl md:text-3xl font-extrabold tracking-tight">Tuyến đường phổ biến</h2>
                  <p className="text-muted-foreground mt-1 text-sm">Các tuyến được đặt nhiều nhất tuần qua</p>
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
                  <Card className="group overflow-hidden border-border/60 shadow-sm hover:shadow-xl hover:shadow-blue-500/10 hover:border-blue-400 hover:-translate-y-1 transition-all duration-300 h-full">
                    <div
                      className="h-1.5"
                      style={{ background: `linear-gradient(90deg, ${r.brand.accentColor}, transparent)` }}
                    />
                    <div className="p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: `${r.brand.accentColor}15`, color: r.brand.accentColor }}
                        >
                          <Bus className="h-3 w-3" />
                          {r.brand.name}
                        </span>
                        <div className="flex items-center gap-1 text-xs text-amber-500">
                          <Star className="h-3 w-3 fill-current" />
                          {r.brand.rating.toFixed(1)}
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-base truncate">{r.from.name}</div>
                          <div className="text-[11px] text-muted-foreground">Điểm đi</div>
                        </div>
                        <div className="shrink-0 h-8 w-8 rounded-full bg-blue-50 flex items-center justify-center group-hover:bg-blue-100 transition-colors">
                          <ArrowRight className="h-4 w-4 text-blue-600 group-hover:translate-x-0.5 transition-transform" />
                        </div>
                        <div className="min-w-0 flex-1 text-right">
                          <div className="font-bold text-base truncate">{r.to.name}</div>
                          <div className="text-[11px] text-muted-foreground">Điểm đến</div>
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatDuration(r.durationMin)}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3 w-3" />
                          {Math.round(r.distanceKm)} km
                        </span>
                        <span className="font-medium text-blue-600">{r.scheduleCount} chuyến/ngày</span>
                      </div>

                      {/* Price display */}
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-bold text-blue-700">
                          Từ {formatCurrency(getPriceFromHash(r.id), currency)}
                        </span>
                        <span className="flex items-center gap-0.5 text-[10px] text-amber-500 font-medium">
                          <TrendingUp className="h-3 w-3" />
                          Phổ biến
                        </span>
                      </div>

                      {/* Popularity bar */}
                      <div className="space-y-1">
                        <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-linear-to-r from-blue-400 to-blue-400 transition-all"
                            style={{ width: `${Math.round((r.scheduleCount / maxSchedules) * 100)}%` }}
                          />
                        </div>
                        <div className="text-[10px] text-muted-foreground text-right">
                          {Math.round((r.scheduleCount / maxSchedules) * 100)}% nhu cầu
                        </div>
                      </div>
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
                Xem tất cả tuyến đường
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </>
        )}
      </div>
    </section>
  )
})
