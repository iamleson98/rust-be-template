'use client'

import { useMemo } from 'react'
import { Navigation2 } from 'lucide-react'
import { toast } from 'sonner'
import type { TripResult } from '@/api'
import { useT } from '@/lib/i18n'
import type { SortKey } from '@/lib/search-params'
import { SearchWidget } from './widget/search-widget'
import { ActiveFilterChips } from './active-filter-chips'
import { CompareTray } from './compare-tray'
import { FiltersSidebar } from './filters-sidebar'
import { ResultsActions } from './results-actions'
import { RouteDirectory } from './route-directory'
import { SavedSearchesList } from './saved-searches'
import { useTripSearch } from './api'
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
  const query = useTripSearch(browsing ? null : search)
  // `keepPreviousData` keeps the old list on screen during a re-search, so `isLoading`
  // stays false; without this the new search would give no feedback at all.
  const loading = query.isLoading || query.isPlaceholderData || (query.isFetching && !query.data)
  // A search without a date is idle: ignore the previous search's trips that the cache still holds.
  const results = search.date ? (query.data?.items ?? NO_RESULTS) : NO_RESULTS
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
    <div className="min-h-[60vh] bg-slate-50">
      <div className="sticky top-16 z-30 border-b bg-white/90 backdrop-blur-lg">
        <div className="container mx-auto px-4 py-2 md:py-3">
          <SearchWidget compact />
        </div>
      </div>

      {browsing ? (
        <div className="container mx-auto px-4 py-6">
          <RouteDirectory />
        </div>
      ) : (
        <>
          {precise && (
            <div className="border-b bg-white/80 backdrop-blur">
              <div className="container mx-auto px-4 py-2">
                <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200">
                  <Navigation2 className="h-3.5 w-3.5" />
                  {t('searchPage.smartSearchShort')}
                </span>
              </div>
            </div>
          )}

          <div className="container mx-auto px-4 py-6">
            <div className="flex flex-col gap-6 lg:flex-row">
              <FiltersSidebar results={results} rf={rf} />

              <div className="min-w-0 flex-1">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <div>
                    <h1 className="text-xl font-extrabold md:text-2xl">
                      {search.from} → {search.to}
                    </h1>
                    <p className="text-sm text-muted-foreground">
                      {loading
                        ? t('searchPage.searchingTrips')
                        : t('searchPage.tripsFound', {
                            found: rf.filtered.length,
                            total: results.length,
                          })}
                    </p>
                  </div>
                  <ResultsActions search={search} results={results} rf={rf} onSave={saveSearch} />
                </div>

                {rf.activeCount > 0 && <ActiveFilterChips rf={rf} brandNames={brandNames} />}
                {saved.items.length > 0 && (
                  <SavedSearchesList items={saved.items} onApply={applySaved} onRemove={saved.remove} />
                )}
                <CompareTray />
                <TripResultsList
                  loading={loading}
                  results={results}
                  filtered={rf.filtered}
                  hasActiveFilters={rf.activeCount > 0}
                  onResetFilters={rf.reset}
                  awaitingDate={!search.date}
                />
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
