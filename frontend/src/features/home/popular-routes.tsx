import { memo, useCallback, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { routesOptions, searchTripsOptions } from '@/api'
import { ErrorState } from '@/components/error-state'
import { PopularRoutesSkeleton } from '@/features/home/components/popular-routes-skeleton'
import { useT } from '@/lib/i18n'
import { buildSearchInput, vnDate } from '@/lib/search-params'
import { useSearchForm } from '@/stores/search-form'
import { cn } from '@/lib/utils'
import { RouteCard } from '@/features/search/route-card'
import { HomeSection, RAIL } from './section'

/** The platform's routes (one card per corridor), each a one-tap search for tomorrow. */
export const PopularRoutes = memo(function PopularRoutes() {
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
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
          <RouteCard
            key={r.id}
            route={r}
            onSelect={() => search(r.from.name, r.to.name)}
            onHover={() => void prefetch(r.from.name, r.to.name)}
          />
        ))}
      </div>
    </HomeSection>
  )
})
