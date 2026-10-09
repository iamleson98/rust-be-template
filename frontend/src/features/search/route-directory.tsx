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

import { usePrefs } from '@/stores/prefs'
import { useSearchForm } from '@/stores/search-form'
import { useMemo, useState } from 'react'
import { useQueryClient, useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import type { RouteOut } from '@/api'
import { routesOptions, searchTripsOptions } from '@/api'
import { buildSearchInput } from '@/lib/search-params'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { slugify } from '@/lib/text'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { ErrorState } from '@/components/error-state'
import { ArrowRight, Bus, SearchX } from 'lucide-react'

/** Accent-insensitive comparison key ("Đà Nẵng" → "danang"). */
const norm = (s: string) => slugify(s).replaceAll('-', '')

export function RouteDirectory() {
  const t = useT()
  const setSearchParams = useSearchForm((s) => s.setSearchParams)
  const currency = usePrefs((s) => s.currency)
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

  const tomorrow = useMemo(() => {
    const d = new Date()
    d.setDate(d.getDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [])

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
          <h1 className="text-xl md:text-2xl font-extrabold">{t('searchPage.directoryTitle')}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('searchPage.directorySubtitle')}
          </p>
        </div>
        <div className="relative w-full sm:w-72">
          <Input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t('searchPage.directoryFilterPh')}
            className="pr-8"
            aria-label={t('searchPage.directoryFilterPh')}
          />
        </div>
      </div>

      {isError ? (
        <ErrorState description={t('home.popularRoutesError')} onRetry={() => refetch()} />
      ) : isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="h-32 animate-pulse bg-slate-100 border-border/60" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-xl border bg-white p-10 text-center">
          <SearchX className="mx-auto h-10 w-10 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">{t('searchPage.directoryEmpty')}</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {items.map((r) => (
            <button
              key={r.id}
              onClick={() => quickSearch(r.from.name, r.to.name)}
              onMouseEnter={() => prefetch(r.from.name, r.to.name)}
              className="group text-left"
            >
              <Card className="group overflow-hidden border-border/60 hover:border-blue-400 hover:-translate-y-0.5 transition-all duration-200">
                <div
                  className="h-1"
                  style={{
                    background: `linear-gradient(90deg, ${r.brand.accentColor ?? '#64748b'}, transparent)`,
                  }}
                />
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold">
                      {r.brand.logoUrl ? (
                        <img
                          src={r.brand.logoUrl}
                          alt=""
                          className="h-5 w-5 shrink-0 rounded object-contain"
                          loading="lazy"
                        />
                      ) : (
                        <Bus
                          className="h-3.5 w-3.5 shrink-0"
                          style={{ color: r.brand.accentColor ?? '#64748b' }}
                        />
                      )}
                      <span
                        className="truncate"
                        style={{ color: r.brand.accentColor ?? '#64748b' }}
                      >
                        {r.brand.name ?? '—'}
                      </span>
                    </span>
                    {r.scheduleCount > 0 && (
                      <span className="shrink-0 text-[11px] font-medium text-blue-600">
                        {t('home.tripsPerDay', { count: r.scheduleCount })}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{r.from.name}</div>
                      <div className="text-[11px] text-muted-foreground">{t('search.from')}</div>
                    </div>
                    <ArrowRight className="h-4 w-4 shrink-0 text-blue-500 group-hover:translate-x-0.5 transition-transform" />
                    <div className="min-w-0 flex-1 text-right">
                      <div className="truncate font-bold">{r.to.name}</div>
                      <div className="text-[11px] text-muted-foreground">{t('search.to')}</div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between border-t pt-2">
                    {r.priceFrom != null ? (
                      <span className="text-sm font-bold text-blue-700">
                        {t('home.priceFrom')} {formatCurrency(r.priceFrom, currency)}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {t('searchPage.noSchedulesYet')}
                      </span>
                    )}
                    <span className="text-[11px] font-semibold text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity">
                      {t('searchPage.searchThisRoute')} →
                    </span>
                  </div>
                </div>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
