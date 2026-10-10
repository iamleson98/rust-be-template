'use client'

import { useMemo } from 'react'
import { Navigation2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TripResult } from '@/api'
import { useT } from '@/lib/i18n'
import type { SortKey } from '@/lib/search-params'
import { SearchWidget } from './widget/search-widget'
import { ActiveFilterChips } from './active-filter-chips'
import { FiltersSidebar } from './filters-sidebar'
import { ResultsActions } from './results-actions'
import { DateStrip } from './date-strip'
import { SortTabs } from './filter-controls'
import { MobileFilters } from './mobile-filters'
import { RouteDirectory } from './route-directory'
import { SavedSearchesList } from './saved-searches'
import { useTripSearchInfinite } from './api'
import { TripResultsList } from './trip-results-list'
import { useResultFilters } from './use-result-filters'
import { useSavedSearches, type SavedSearch } from './use-saved-searches'
import { useSearchUrl } from './use-search-url'

const NO_RESULTS: TripResult[] = []

/** The `/search` page body: query bar, filters, results; or the route catalogue until both ends are picked. */
export function SearchResults() {
  const t = useT()
  const { search, update } = useSearchUrl()
  const saved = useSavedSearches()

  const browsing = !search.from || !search.to
  const query = useTripSearchInfinite(browsing ? null : search)
  // `keepPreviousData` keeps the old list on screen during a re-search, so `isLoading`
  // stays false; without this the new search would give no feedback at all.
  const loading = query.isLoading || query.isPlaceholderData || (query.isFetching && !query.data)
  // A search without a date is idle: ignore the previous search's trips that the cache still holds.
  const pages = search.date ? query.data?.pages : undefined
  const results = useMemo(() => pages?.flatMap((page) => page.items) ?? NO_RESULTS, [pages])
  // The server's total across all pages, or what is loaded when it sent no page metadata.
  const total = pages?.at(-1)?.total ?? results.length
  const rf = useResultFilters(results)

  const brandNames = useMemo(
    () => Object.fromEntries(results.map((r) => [r.brandSlug, r.brandName || r.brandSlug])),
    [results],
  )

  const saveSearch = () => {
    saved.add({
      from: search.from,
      to: search.to,
      date: search.date,
      adults: search.adults,
      children: search.children,
      sort: search.sort,
      vehicleTypes: search.vehicleTypes,
      filters: rf.filters,
    })
    toast.success(t('searchPage.searchSaved'), {
      description: `${search.from} → ${search.to} • ${search.date}`,
    })
  }

  const applySaved = (s: SavedSearch) => {
    update({ ...s, sort: s.sort as SortKey })
    rf.setFilters(s.filters)
    toast.success(t('searchPage.savedSearchApplied'))
  }

  const precise = search.fromLat !== undefined

  return (
    <div className="min-h-[60vh]">
      <div className="sticky top-(--header-h) z-30 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
        <div className="page-x py-2 lg:py-3">
          <SearchWidget compact />
        </div>
      </div>

      {browsing ? (
        <div className="page-x py-6">
          <RouteDirectory />
        </div>
      ) : (
        <div className="page-x py-5 md:py-6">
          {search.date && <DateStrip date={search.date} onPick={(date) => update({ date })} />}

          <div className="mt-5 flex gap-6">
            <FiltersSidebar results={results} rf={rf} />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
                <div className="min-w-0">
                  <h1 className="text-xl font-bold tracking-tight text-balance text-slate-900 md:text-2xl">
                    {search.from} → {search.to}
                  </h1>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-slate-500">
                    {loading
                      ? t('searchPage.searchingTrips')
                      : t('searchPage.tripsFound', { found: rf.filtered.length, total })}
                    {precise && (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
                        <Navigation2 className="size-3" />
                        {t('searchPage.smartSearchShort')}
                      </span>
                    )}
                  </p>
                </div>
                <ResultsActions search={search} results={results} onSave={saveSearch} />
              </div>

              {/* Sort for everyone; the filters button below lg (the sidebar takes over above). */}
              <div className="mt-4 flex items-center gap-2">
                <SortTabs />
                <div className="ml-auto shrink-0">
                  <MobileFilters results={results} rf={rf} />
                </div>
              </div>

              {rf.activeCount > 0 && (
                <div className="mt-3">
                  <ActiveFilterChips rf={rf} brandNames={brandNames} />
                </div>
              )}
              {saved.items.length > 0 && (
                <SavedSearchesList
                  items={saved.items}
                  onApply={applySaved}
                  onRemove={saved.remove}
                />
              )}
              <div className="mt-4">
                <TripResultsList
                  loading={loading}
                  results={results}
                  filtered={rf.filtered}
                  hasActiveFilters={rf.activeCount > 0}
                  onResetFilters={rf.reset}
                  awaitingDate={!search.date}
                  pagination={{
                    // A new search replaces the list, so the old pages' cursor means nothing.
                    hasMore: query.hasNextPage && !loading,
                    loadingMore: query.isFetchingNextPage,
                    onLoadMore: () => void query.fetchNextPage(),
                    total,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
