'use client'

/**
 * RouteDirectory — the browse mode of the /search page.
 *
 * When the user hasn't picked a from/to yet (or cleared them), the
 * search page shows every ACTIVE route with real schedule counts and
 * real "from" prices, filterable by typing. One tap on a card jumps
 * straight into a prefilled search for that route (tomorrow's date).
 *
 * This is the "I don't know what to type" answer to schedule
 * discovery — no dead ends, no fabricated prices.
 */

import { useSearchForm } from '@/stores/search-form'
import { useMemo, useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { RouteOut } from '@/api'
import { routesOptions, searchTripsOptions } from '@/api'
import { buildSearchInput, vnDate } from '@/lib/search-params'
import { useT } from '@/lib/i18n'
import { slugify } from '@/lib/text'
import { Input } from '@/components/ui/input'
import { Shimmer } from '@/components/ui/shimmer'
import { ErrorState } from '@/components/error-state'
import { SearchX } from 'lucide-react'
import { RouteCard } from './route-card'

/** Accent-insensitive comparison key ("Đà Nẵng" → "danang"). */
const norm = (s: string) => slugify(s).replaceAll('-', '')

export function RouteDirectory() {
  const t = useT()
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [filter, setFilter] = useState('')

  // The full active-route catalog (schedule counts + real prices).
  const { data, isLoading, isError, refetch } = useQuery({
    ...routesOptions({ query: { limit: 200 } }),
    staleTime: 5 * 60 * 1000,
  })
  const items: RouteOut[] = useMemo(() => {
    const all = data?.items ?? []
    const q = norm(filter.trim())
    if (!q) return all
    return all.filter(
      (r) =>
        norm(r.from.name).includes(q) ||
        norm(r.to.name).includes(q) ||
        norm(r.brand.name ?? '').includes(q),
    )
  }, [data, filter])

  const tomorrow = useMemo(() => vnDate(1), [])

  const quickSearch = (from: string, to: string) => {
    setSearchParams({ from, to, date: tomorrow })
    navigate({ to: '/search', search: buildSearchInput({ from, to, date: tomorrow }) })
  }

  // Prefetch the route's trips on hover so the jump feels instant.
  // Uses the SAME options object (hence the same query key) as
  // useTripSearch, so the prefetched cache entry is actually a hit.
  const prefetch = (from: string, to: string) => {
    queryClient.prefetchQuery(
      searchTripsOptions({ query: { from, to, date: tomorrow, sort: 'departure', minSeats: 1 } }),
    )
  }

  return (
    <div>
      <div className="mb-5 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-slate-900 md:text-2xl">
            {t('searchPage.directoryTitle')}
          </h1>
          <p className="mt-0.5 text-sm text-slate-500">{t('searchPage.directorySubtitle')}</p>
        </div>
        <div className="relative w-full sm:w-72">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('searchPage.directoryFilterPh')}
            className="h-11 rounded-xl bg-white pr-8"
            aria-label={t('searchPage.directoryFilterPh')}
          />
        </div>
      </div>

      {isError ? (
        <ErrorState description={t('home.popularRoutesError')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="h-40 rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl bg-white p-10 text-center shadow-soft ring-1 ring-slate-200/80">
          <SearchX className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t('searchPage.directoryEmpty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
          {items.map((r) => (
            <RouteCard
              key={r.id}
              route={r}
              onSelect={() => quickSearch(r.from.name, r.to.name)}
              onHover={() => prefetch(r.from.name, r.to.name)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
