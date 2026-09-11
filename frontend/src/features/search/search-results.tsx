'use client'

import { useState, useMemo, useEffect } from 'react'
import { useApp } from '@/lib/store'
import { useTripSearch, type TripSearchParams } from '@/lib/queries'
import { buildSearchInput } from '@/lib/search-params'
import { Bell, GitCompare, Heart, Sparkles, X } from 'lucide-react'
import { SearchWidget } from '@/features/home/search-widget'
import { DatePriceCompare } from '@/features/search/date-price-compare'
import { Button } from '@/components/ui/button'
import { toast } from 'sonner'
import { getHourOfDeparture, matchesTimeRange, type Filters, type NavigateFn, type RouteSearch } from './helpers'
import { type SavedSearch, loadSavedSearches, persistSavedSearches, SavedSearchesList } from './saved-searches'
import { FiltersSidebar } from './filters-sidebar'
import { MobileFiltersSheet } from './mobile-filters'
import { ActiveFilterChips } from './active-filter-chips'
import { TripResultsList } from './trip-results-list'

export type { RouteSearch } from './helpers'

/* ─── Main Component ─── */

export function SearchResults({ routeSearch, navigate }: { routeSearch: RouteSearch; navigate: NavigateFn }) {
  const { compareList, setCompareOpen, clearCompare, setPriceAlertOpen, setPriceAlertContext } = useApp()

  // Drive the search via TanStack Query — the URL (routeSearch) is the
  // single source of truth: updating filters updates the URL, which
  // re-runs this query. `placeholderData: keepPreviousData` (set inside
  // the hook) keeps the previous results visible while the new ones load,
  // so filter changes feel instantaneous.
  const tripSearchParams: TripSearchParams | null =
    routeSearch.from || routeSearch.to
      ? {
        from: routeSearch.from,
        to: routeSearch.to,
        date: routeSearch.date,
        adults: routeSearch.adults,
        children: routeSearch.children,
        sort: routeSearch.sort,
        vehicleTypes: routeSearch.vehicleTypes,
        roundTrip: routeSearch.roundTrip,
        returnDate: routeSearch.returnDate,
      }
      : null
  const { data: searchData, isLoading: searchLoading } = useTripSearch(tripSearchParams)
  const searchResults = searchData?.items ?? []

  // Cache results in window global so compare can read them without refetch
  useEffect(() => {
    if (typeof window !== 'undefined') {
      ; (window as any).__lastSearchResults = searchResults
    }
  }, [searchResults])

  // Helper: navigate to /search with merged params. The URL is the source
  // of truth — updating it re-runs useTripSearch automatically. Uses
  // buildSearchInput so only non-default values appear in the URL.
  const updateRouteSearch = (changes: Partial<RouteSearch>) => {
    const next: RouteSearch = { ...routeSearch, ...changes }
    navigate({
      to: '/search',
      search: buildSearchInput({
        from: next.from,
        to: next.to,
        date: next.date,
        adults: next.adults,
        children: next.children,
        sort: next.sort,
        vehicleTypes: next.vehicleTypes,
        roundTrip: next.roundTrip,
        returnDate: next.returnDate,
      }),
    })
  }

  // Compute price bounds from results
  const priceBounds = useMemo<[number, number]>(() => {
    if (searchResults.length === 0) return [0, 1000000]
    const min = Math.min(...searchResults.map((t) => t.minPrice))
    const max = Math.max(...searchResults.map((t) => t.maxPrice))
    // Round to nearest 50k for nicer slider
    const rMin = Math.floor(min / 50000) * 50000
    const rMax = Math.ceil(max / 50000) * 50000
    return [rMin, rMax]
  }, [searchResults])

  // Filter state — priceMin/priceMax stored as raw user selection.
  // Use 0 as sentinel for"use bounds"so we don't need to sync via effect.
  const [filters, setFilters] = useState<Filters>({
    priceMin: 0,
    priceMax: 0,
    timeRanges: [],
    minRating: 0,
    availableOnly: false,
    amenities: [],
  })

  // Effective price range used for slider display + filtering (clamped to bounds)
  const effectivePriceRange = useMemo<[number, number]>(() => {
    const lo = filters.priceMin === 0 || filters.priceMin < priceBounds[0] ? priceBounds[0] : filters.priceMin
    const hi = filters.priceMax === 0 || filters.priceMax > priceBounds[1] ? priceBounds[1] : filters.priceMax
    return [lo, hi]
  }, [filters.priceMin, filters.priceMax, priceBounds])

  // Reset filter selection when bounds signature changes (new search) — render-phase sync
  const boundsSignature = `${priceBounds[0]}-${priceBounds[1]}`
  const [lastBoundsSig, setLastBoundsSig] = useState(boundsSignature)
  if (boundsSignature !== lastBoundsSig) {
    setLastBoundsSig(boundsSignature)
    if (filters.priceMin !== 0 || filters.priceMax !== 0) {
      setFilters((prev) => ({ ...prev, priceMin: 0, priceMax: 0 }))
    }
  }

  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([])
  const [mobileFilterOpen, setMobileFilterOpen] = useState(false)

  // Load saved searches from localStorage after mount (avoids SSR mismatch)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSavedSearches(loadSavedSearches())
  }, [])

  // Apply filters client-side
  const filteredResults = useMemo(() => {
    if (searchResults.length === 0) return []
    const [pLo, pHi] = effectivePriceRange
    return searchResults.filter((t) => {
      if (t.minPrice < pLo) return false
      if (t.minPrice > pHi) return false
      if (filters.timeRanges.length > 0) {
        const hour = getHourOfDeparture(t)
        const matched = filters.timeRanges.some((r) => matchesTimeRange(hour, r))
        if (!matched) return false
      }
      if (filters.minRating > 0 && t.brandRating < filters.minRating) return false
      if (filters.availableOnly && t.availableSeats <= 5) return false
      if (filters.amenities.length > 0) {
        const tAmenities = t.amenities ?? []
        const hasAll = filters.amenities.every((a) => tAmenities.includes(a))
        if (!hasAll) return false
      }
      return true
    })
  }, [searchResults, filters, effectivePriceRange])

  // Count active filters (excluding price when at bounds)
  const activeFilterCount = useMemo(() => {
    let count = 0
    if (effectivePriceRange[0] > priceBounds[0] || effectivePriceRange[1] < priceBounds[1]) count++
    if (filters.timeRanges.length > 0) count += filters.timeRanges.length
    if (filters.minRating > 0) count++
    if (filters.availableOnly) count++
    if (filters.amenities.length > 0) count += filters.amenities.length
    return count
  }, [effectivePriceRange, priceBounds, filters])

  const resetFilters = () => {
    setFilters({
      priceMin: 0,
      priceMax: 0,
      timeRanges: [],
      minRating: 0,
      availableOnly: false,
      amenities: [],
    })
  }

  const handleSaveSearch = () => {
    const saved: SavedSearch = {
      id: `s${Date.now()}`,
      savedAt: Date.now(),
      from: routeSearch.from,
      to: routeSearch.to,
      date: routeSearch.date,
      adults: routeSearch.adults,
      children: routeSearch.children,
      sort: routeSearch.sort,
      vehicleTypes: routeSearch.vehicleTypes,
      filters: { ...filters },
    }
    const next = [saved, ...savedSearches].slice(0, 20)
    setSavedSearches(next)
    persistSavedSearches(next)
    toast.success('Đã lưu tìm kiếm', {
      description: `${routeSearch.from} → ${routeSearch.to} • ${routeSearch.date}`,
    })
  }

  const removeSavedSearch = (id: string) => {
    const next = savedSearches.filter((s) => s.id !== id)
    setSavedSearches(next)
    persistSavedSearches(next)
  }

  const applySavedSearch = (s: SavedSearch) => {
    updateRouteSearch({
      from: s.from,
      to: s.to,
      date: s.date,
      adults: s.adults,
      children: s.children,
      sort: s.sort as any,
      vehicleTypes: s.vehicleTypes,
    })
    setFilters(s.filters)
    toast.success('Đã áp dụng tìm kiếm đã lưu')
  }

  const minPrice = useMemo(
    () => (searchResults.length > 0 ? Math.min(...searchResults.map((t) => t.minPrice)) : 0),
    [searchResults],
  )
  const maxAvail = useMemo(
    () => (searchResults.length > 0 ? Math.max(...searchResults.map((t) => t.availableSeats)) : 0),
    [searchResults],
  )

  return (
    <div className="bg-slate-50 min-h-[60vh]">
      {/* Compact search bar */}
      <div className="bg-white/90 backdrop-blur-lg border-b sticky top-16 z-30">
        <div className="container mx-auto px-4 py-3">
          <SearchWidget compact />
        </div>
      </div>

      {/* Date price comparison */}
      <div className="bg-white/80 backdrop-blur border-b">
        <div className="container mx-auto px-4 py-3">
          <DatePriceCompare />
        </div>
      </div>

      <div className="container mx-auto px-4 py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Sidebar filters (desktop) */}
          <FiltersSidebar
            routeSearch={routeSearch}
            updateRouteSearch={updateRouteSearch}
            searchResults={searchResults}
            filters={filters}
            setFilters={setFilters}
            priceBounds={priceBounds}
            effectivePriceRange={effectivePriceRange}
            activeFilterCount={activeFilterCount}
            resetFilters={resetFilters}
            minPrice={minPrice}
            maxAvail={maxAvail}
          />

          {/* Results */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between mb-4 gap-3">
              <div>
                <h1 className="text-xl md:text-2xl font-extrabold">
                  {routeSearch.from} → {routeSearch.to}
                </h1>
                <p className="text-sm text-muted-foreground">
                  {searchLoading
                    ? 'Đang tìm chuyến...'
                    : `${filteredResults.length}/${searchResults.length} chuyến xe tìm thấy`}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Save Search */}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleSaveSearch}
                  disabled={searchResults.length === 0}
                  className="gap-1.5 border-rose-300 text-rose-700 hover:bg-rose-50"
                  title="Lưu tìm kiếm này"
                >
                  <Heart className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Lưu</span>
                </Button>
                {/* Price Alert (existing feature) */}
                {routeSearch.from && routeSearch.to && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPriceAlertContext({
                        fromName: routeSearch.from,
                        toName: routeSearch.to,
                        minPrice: minPrice > 0 ? minPrice : 0,
                      })
                      setPriceAlertOpen(true)
                    }}
                    className="gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50 hover:text-blue-800"
                  >
                    <Bell className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Theo dõi giá</span>
                  </Button>
                )}
                {/* Mobile filter trigger */}
                <MobileFiltersSheet
                  mobileFilterOpen={mobileFilterOpen}
                  setMobileFilterOpen={setMobileFilterOpen}
                  activeFilterCount={activeFilterCount}
                  routeSearch={routeSearch}
                  updateRouteSearch={updateRouteSearch}
                  searchResults={searchResults}
                  filters={filters}
                  setFilters={setFilters}
                  priceBounds={priceBounds}
                  effectivePriceRange={effectivePriceRange}
                  resetFilters={resetFilters}
                />
                {compareList.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setCompareOpen(true)}
                    className="gap-1.5 border-amber-300 text-violet-700 hover:bg-violet-50"
                  >
                    <GitCompare className="h-3.5 w-3.5" />
                    So sánh ({compareList.length})
                  </Button>
                )}
                {searchResults.length > 0 && (
                  <div className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                    Giá tốt nhất được đánh dấu
                  </div>
                )}
              </div>
            </div>

            {/* Active Filters Chips */}
            {activeFilterCount > 0 && (
              <ActiveFilterChips
                filters={filters}
                setFilters={setFilters}
                effectivePriceRange={effectivePriceRange}
                priceBounds={priceBounds}
                resetFilters={resetFilters}
              />
            )}
            {/* Saved Searches (collapsible list) */}
            {savedSearches.length > 0 && (
              <SavedSearchesList
                savedSearches={savedSearches}
                applySavedSearch={applySavedSearch}
                removeSavedSearch={removeSavedSearch}
              />
            )}

            {/* Compare tray */}
            {compareList.length > 0 && (
              <div



                className="mb-3 overflow-hidden"
              >
                <div className="rounded-xl bg-linear-to-r from-violet-50 to-fuchsia-50 ring-1 ring-violet-200 p-3 flex items-center gap-3">
                  <GitCompare className="h-4 w-4 text-violet-600 shrink-0" />
                  <div className="text-xs text-violet-700 flex-1">
                    <span className="font-semibold">{compareList.length}/3</span> chuyến đã chọn để so sánh
                  </div>
                  <Button
                    size="sm"
                    variant="default"
                    className="h-7 gap-1 text-xs bg-violet-600 hover:bg-violet-700"
                    onClick={() => setCompareOpen(true)}
                  >
                    So sánh ngay
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 gap-1 text-xs text-violet-700 hover:bg-violet-100"
                    onClick={clearCompare}
                  >
                    <X className="h-3 w-3" />
                    Xoá
                  </Button>
                </div>
              </div>
            )}
            <TripResultsList
              searchLoading={searchLoading}
              searchResults={searchResults}
              filteredResults={filteredResults}
              activeFilterCount={activeFilterCount}
              resetFilters={resetFilters}
              navigate={navigate}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
