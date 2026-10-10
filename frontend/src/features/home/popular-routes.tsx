import { memo, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, Star } from 'lucide-react'
import { routesOptions, searchTripsOptions } from '@/api'
import { ErrorState } from '@/components/error-state'
import { PopularRoutesSkeleton } from '@/features/home/components/popular-routes-skeleton'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { buildSearchInput, vnDate } from '@/lib/search-params'
import { usePrefs } from '@/stores/prefs'
import { useSearchForm } from '@/stores/search-form'
import { cn } from '@/lib/utils'
import { HomeSection, RAIL } from './section'

/** The platform's routes (one card per corridor), each a one-tap search for tomorrow. */
export const PopularRoutes = memo(function PopularRoutes() {
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  const currency = usePrefs((s) => s.currency)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const t = useT()
  const { data, isLoading, isError, refetch } = useQuery(routesOptions())

  const routes = useMemo(() => {
    const seen = new Set<string>()
    return (data?.items ?? [])
      .filter((r) => {
        const key = `${r.from.name}→${r.to.name}`
        if (seen.has(key)) return false
        seen.add(key)
        return true
      })
      .slice(0, 8)
  }, [data])

  const search = useCallback(
    (from: string, to: string) => {
      const date = vnDate(1)
      setSearchParams({ from, to, date })
      navigate({ to: '/search', search: buildSearchInput({ from, to, date }) })
    },
    [setSearchParams, navigate],
  )

  // Same options (hence query key) as the results page, so a hover warms its cache.
  const prefetch = useCallback(
    (from: string, to: string) =>
      queryClient.prefetchQuery(
        searchTripsOptions({
          query: { from, to, date: vnDate(1), sort: 'departure', minSeats: 1 },
        }),
      ),
    [queryClient],
  )

  if (isLoading) return <PopularRoutesSkeleton count={4} />
  if (isError)
    return (
      <div className="page-x py-10">
        <ErrorState description={t('home.popularRoutesError')} onRetry={() => refetch()} />
      </div>
    )
  if (routes.length === 0) return null

  return (
    <HomeSection
      title={t('home.popularRoutesTitle')}
      subtitle={t('home.popularRoutesSubtitle')}
      action={
        <button
          onClick={() => navigate({ to: '/search', search: buildSearchInput({ date: vnDate(1) }) })}
          className="inline-flex shrink-0 items-center gap-0.5 text-sm font-semibold text-primary hover:underline"
        >
          {t('home.viewAllRoutes')}
          <ChevronRight className="size-4" />
        </button>
      }
    >
      <div className={cn(RAIL, 'lg:grid-cols-4')}>
        {routes.map((r) => (
          <button
            key={r.id}
            onClick={() => search(r.from.name, r.to.name)}
            onMouseEnter={() => void prefetch(r.from.name, r.to.name)}
            className="group flex flex-col rounded-2xl bg-white p-4 text-left shadow-soft ring-1 ring-slate-200/80 transition duration-200 hover:-translate-y-0.5 hover:shadow-float hover:ring-primary/30"
          >
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className="size-2 shrink-0 rounded-full"
                style={{ background: r.brand.accentColor ?? '#64748b' }}
              />
              <span className="truncate">{r.brand.name}</span>
              {r.brand.rating != null && (
                <span className="ml-auto inline-flex shrink-0 items-center gap-0.5 font-medium text-slate-700">
                  <Star className="size-3 fill-amber-400 text-amber-400" />
                  {r.brand.rating.toFixed(1)}
                </span>
              )}
            </div>

            <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3">
              <div className="flex flex-col items-center pt-1.5 pb-1.5">
                <span className="size-2 rounded-full border-2 border-primary" />
                <span className="my-1 w-px flex-1 border-l border-dashed border-slate-300" />
                <span className="size-2 rounded-full bg-rose-500" />
              </div>
              <div className="min-w-0 space-y-2.5">
                <div className="truncate text-[15px] font-semibold text-slate-900">
                  {r.from.name}
                </div>
                <div className="truncate text-[15px] font-semibold text-slate-900">{r.to.name}</div>
              </div>
            </div>

            <div className="mt-4 flex items-end justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-xs text-slate-500">
                {t('home.tripsPerDay', { count: r.scheduleCount })}
              </span>
              {r.priceFrom != null ? (
                <span className="text-right leading-tight">
                  <span className="block text-[11px] text-slate-500">{t('home.priceFrom')}</span>
                  <span className="text-base font-bold text-primary tabular-nums">
                    {formatCurrency(r.priceFrom, currency)}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-slate-400">{t('searchPage.noSchedulesYet')}</span>
              )}
            </div>
          </button>
        ))}
      </div>
    </HomeSection>
  )
})
