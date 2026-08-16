'use client'

import { useState, useMemo, useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { useApp, type TripResult } from '@/lib/store'
import { useTripSearch, type TripSearchParams } from '@/lib/queries'
import { buildSearchInput } from '@/lib/search-params'
import type { UseNavigateResult } from '@tanstack/react-router'
import { TripCard, TripCardSkeleton } from './trip-card'
import { SearchWidget } from './search-widget'
import {
  Loader2,
  Bus,
  SlidersHorizontal,
  AlertCircle,
  Sparkles,
  GitCompare,
  X,
  Heart,
  Bookmark,
  Wifi,
  Snowflake,
  Droplet,
  Zap,
  BedDouble,
  Filter,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  Star,
  Users,
  Bell,
} from 'lucide-react'
import { DatePriceCompare } from './date-price-compare'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Slider } from '@/components/ui/slider'
import { Checkbox } from '@/components/ui/checkbox'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currency'
import { toast } from 'sonner'

type TimeRange = '0-6' | '6-12' | '12-18' | '18-24'

type Filters = {
  priceMin: number
  priceMax: number
  timeRanges: TimeRange[]
  minRating: number
  availableOnly: boolean
  amenities: string[]
}

const TIME_RANGE_OPTIONS: { key: TimeRange; label: string; icon: React.ReactNode }[] = [
  { key: '0-6', label: 'Sáng sớm (0-6h)', icon: <Sunrise className="h-3.5 w-3.5" /> },
  { key: '6-12', label: 'Ban ngày (6-12h)', icon: <Sun className="h-3.5 w-3.5" /> },
  { key: '12-18', label: 'Chiều (12-18h)', icon: <Sunset className="h-3.5 w-3.5" /> },
  { key: '18-24', label: 'Ban đêm (18-24h)', icon: <Moon className="h-3.5 w-3.5" /> },
]

const AMENITY_OPTIONS: { key: string; label: string; icon: React.ReactNode }[] = [
  { key: 'wifi', label: 'WiFi', icon: <Wifi className="h-3.5 w-3.5" /> },
  { key: 'ac', label: 'Điều hòa', icon: <Snowflake className="h-3.5 w-3.5" /> },
  { key: 'water', label: 'Nước uống', icon: <Droplet className="h-3.5 w-3.5" /> },
  { key: 'charging', label: 'Cắm sạc', icon: <Zap className="h-3.5 w-3.5" /> },
  { key: 'blanket', label: 'Chăn mền', icon: <BedDouble className="h-3.5 w-3.5" /> },
]

const RATING_OPTIONS = [
  { value: 0, label: 'Tất cả' },
  { value: 4.0, label: '4.0+' },
  { value: 4.5, label: '4.5+' },
  { value: 4.8, label: '4.8+' },
]

const SAVED_SEARCHES_KEY = 'bus_saved_searches'

type SavedSearch = {
  id: string
  savedAt: number
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: string
  vehicleTypes: string[]
  filters: Filters
}

/* ─── Helpers ─── */

function getHourOfDeparture(t: TripResult): number {
  // Try departureAt first; fallback to parsing departureTime"HH:mm"
  if (t.departureAt) {
    const d = new Date(t.departureAt)
    const h = d.getHours()
    if (!Number.isNaN(h)) return h
  }
  const m = /(\d{1,2}):(\d{2})/.exec(t.departureTime ?? '')
  return m ? parseInt(m[1], 10) : 12
}

function matchesTimeRange(hour: number, range: TimeRange): boolean {
  const [start, end] = range.split('-').map(Number)
  return hour >= start && hour < end
}

function loadSavedSearches(): SavedSearch[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(SAVED_SEARCHES_KEY)
    return raw ? (JSON.parse(raw) as SavedSearch[]) : []
  } catch {
    return []
  }
}

function persistSavedSearches(items: SavedSearch[]) {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SAVED_SEARCHES_KEY, JSON.stringify(items))
  } catch { }
}

/* ─── Sub-component: Filter Panel ─── */

/** Shape of the typed search params coming from the /search route. */
export type RouteSearch = {
  from: string
  to: string
  date: string
  adults: number
  children: number
  sort: 'departure' | 'price' | 'duration' | 'rating'
  vehicleTypes: string[]
  roundTrip: boolean
  returnDate: string
}

type NavigateFn = UseNavigateResult<string>

function FilterPanel({
  searchResults,
  filters,
  setFilters,
  priceBounds,
  effectivePriceRange,
  isMobile = false,
}: {
  searchResults: TripResult[]
  filters: Filters
  setFilters: (f: Filters) => void
  priceBounds: [number, number]
  effectivePriceRange: [number, number]
  isMobile?: boolean
}) {
  const { currency } = useApp()
  const updatePrice = (val: number[]) => {
    setFilters({ ...filters, priceMin: val[0], priceMax: val[1] })
  }

  const toggleTimeRange = (key: TimeRange) => {
    const exists = filters.timeRanges.includes(key)
    setFilters({
      ...filters,
      timeRanges: exists ? filters.timeRanges.filter((x) => x !== key) : [...filters.timeRanges, key],
    })
  }

  const toggleAmenity = (key: string) => {
    const exists = filters.amenities.includes(key)
    setFilters({
      ...filters,
      amenities: exists ? filters.amenities.filter((x) => x !== key) : [...filters.amenities, key],
    })
  }

  // Count results per filter option (independent of that filter being active)
  const countForTimeRange = (key: TimeRange) =>
    searchResults.filter((t) => matchesTimeRange(getHourOfDeparture(t), key)).length

  // `?? []` defends against incomplete API items — the search endpoint may
  // return minimal trip objects before enrichment fills in `amenities`.
  const countForAmenity = (key: string) => searchResults.filter((t) => (t.amenities ?? []).includes(key)).length

  const countForRating = (value: number) =>
    value === 0 ? searchResults.length : searchResults.filter((t) => t.brandRating >= value).length

  const countAvailableOnly = searchResults.filter((t) => t.availableSeats > 5).length

  return (
    <div className={cn('space-y-4', isMobile && 'space-y-5')}>
      {/* Price Range Slider */}
      <div>
        <div className="flex items-center justify-between mb-2 gap-2">
          <span className="text-xs font-semibold uppercase text-muted-foreground shrink-0">Khoảng giá</span>
          <span className="text-[11px] font-medium text-blue-700 text-right tabular-nums leading-tight">
            {formatCurrency(effectivePriceRange[0], currency)}
            <span className="text-slate-400 mx-0.5">–</span>
            {formatCurrency(effectivePriceRange[1], currency)}
          </span>
        </div>
        <Slider
          value={[effectivePriceRange[0], effectivePriceRange[1]]}
          min={priceBounds[0]}
          max={priceBounds[1]}
          step={50000}
          onValueChange={updatePrice}
          className="py-2"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-1 tabular-nums">
          <span>{formatCurrency(priceBounds[0], currency)}</span>
          <span>{formatCurrency(priceBounds[1], currency)}</span>
        </div>
      </div>

      {/* Departure Time Range */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Giờ khởi hành</div>
        <div className="space-y-1.5">
          {TIME_RANGE_OPTIONS.map((opt) => {
            const active = filters.timeRanges.includes(opt.key)
            const count = countForTimeRange(opt.key)
            return (
              <label key={opt.key} className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggleTimeRange(opt.key)}
                  className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                />
                <span className="flex items-center gap-1.5 group-hover:text-blue-700 transition-colors flex-1">
                  <span className="text-blue-500">{opt.icon}</span>
                  {opt.label}
                </span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{count}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>

      {/* Minimum Rating */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Đánh giá tối thiểu</div>
        <RadioGroup
          value={String(filters.minRating)}
          onValueChange={(v) => setFilters({ ...filters, minRating: Number(v) })}
          className="grid grid-cols-2 gap-1.5"
        >
          {RATING_OPTIONS.map((opt) => {
            const count = countForRating(opt.value)
            return (
              <label
                key={opt.value}
                className={cn(
                  'flex items-center gap-2 cursor-pointer px-2 py-1.5 rounded-md border text-sm transition-all',
                  filters.minRating === opt.value
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                    : 'border-transparent hover:bg-slate-100'
                )}
              >
                <RadioGroupItem
                  value={String(opt.value)}
                  id={`rating-${opt.value}`}
                  className="data-[state=checked]:border-blue-600 data-[state=checked]:text-blue-600"
                />
                {opt.value > 0 && <Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                <span className="flex-1">{opt.label}</span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground">{count}</span>
                )}
              </label>
            )
          })}
        </RadioGroup>
      </div>

      {/* Available Seats */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Số ghế trống</div>
        <label className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
          <Checkbox
            checked={filters.availableOnly}
            onCheckedChange={(c) => setFilters({ ...filters, availableOnly: c === true })}
            className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
          />
          <span className="flex items-center gap-1.5 group-hover:text-blue-700 transition-colors flex-1">
            <Users className="h-3.5 w-3.5 text-blue-500" />
            Chỉ hiện chuyến còn &gt; 5 chỗ
          </span>
          {countAvailableOnly > 0 && (
            <span className="text-[10px] text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{countAvailableOnly}</span>
          )}
        </label>
      </div>

      {/* Amenities */}
      <div className="pt-3 border-t">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Tiện ích</div>
        <div className="grid grid-cols-2 gap-1.5">
          {AMENITY_OPTIONS.map((opt) => {
            const active = filters.amenities.includes(opt.key)
            const count = countForAmenity(opt.key)
            return (
              <label
                key={opt.key}
                className={cn(
                  'flex items-center gap-1.5 cursor-pointer px-2 py-1.5 rounded-md border text-xs transition-all',
                  active
                    ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium'
                    : 'border-slate-200 hover:bg-slate-50'
                )}
              >
                <Checkbox
                  checked={active}
                  onCheckedChange={() => toggleAmenity(opt.key)}
                  className="h-3.5 w-3.5 data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                />
                <span className="text-blue-500">{opt.icon}</span>
                <span className="flex-1 truncate">{opt.label}</span>
                {count > 0 && (
                  <span className="text-[10px] text-muted-foreground">{count}</span>
                )}
              </label>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/* ─── Main Component ─── */

export function SearchResults({ routeSearch, navigate }: { routeSearch: RouteSearch; navigate: NavigateFn }) {
  const { compareList, setCompareOpen, clearCompare, setPriceAlertOpen, setPriceAlertContext, currency } = useApp()

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
  const { data: searchData, isLoading: searchLoading, isFetching } = useTripSearch(tripSearchParams)
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

  const sortOptions: { key: 'departure' | 'price' | 'duration' | 'rating'; label: string; icon: string }[] = [
    { key: 'departure', label: 'Giờ đi', icon: '🕐' },
    { key: 'price', label: 'Giá rẻ nhất', icon: '💰' },
    { key: 'duration', label: 'Nhanh nhất', icon: '⚡' },
    { key: 'rating', label: 'Đánh giá', icon: '⭐' },
  ]

  const minPrice = useMemo(
    () => (searchResults.length > 0 ? Math.min(...searchResults.map((t) => t.minPrice)) : 0),
    [searchResults],
  )
  const maxAvail = useMemo(
    () => (searchResults.length > 0 ? Math.max(...searchResults.map((t) => t.availableSeats)) : 0),
    [searchResults],
  )

  // Pre-compute top-rated / cheapest flags once for the recommended badge
  // (avoids O(n²) Math.max/Math.min inside the render loop).
  const { topRating, cheapestPrice } = useMemo(() => {
    if (filteredResults.length === 0) return { topRating: 0, cheapestPrice: 0 }
    let topRating = -Infinity
    let cheapestPrice = Infinity
    for (const r of filteredResults) {
      if (r.brandRating > topRating) topRating = r.brandRating
      if (r.minPrice < cheapestPrice) cheapestPrice = r.minPrice
    }
    return { topRating, cheapestPrice }
  }, [filteredResults])

  // Virtualize the trip list when it grows past ~30 items — otherwise the
  // overhead of the virtualizer (ResizeObserver + absolute positioning)
  // isn't worth the perf win for typical ~12-result pages.
  const TRIP_VIRTUAL_THRESHOLD = 30
  const shouldVirtualize = filteredResults.length > TRIP_VIRTUAL_THRESHOLD
  const listParentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: shouldVirtualize ? filteredResults.length : 0,
    getScrollElement: () => listParentRef.current,
    estimateSize: () => 200,
    overscan: 4,
    enabled: shouldVirtualize,
  })

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
          <aside className="lg:w-80 shrink-0 hidden lg:block">
            <div className="lg:sticky lg:top-32 space-y-4">
              <div className="rounded-xl border bg-white p-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2 font-semibold">
                    <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                    Bộ lọc
                    {activeFilterCount > 0 && (
                      <Badge className="bg-blue-600 text-white text-[10px] ml-1 h-5 min-w-5 px-1 flex items-center justify-center">
                        {activeFilterCount}
                      </Badge>
                    )}
                  </div>
                  {activeFilterCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={resetFilters} className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50">
                      Xoá tất cả
                    </Button>
                  )}
                </div>

                <div className="space-y-3">
                  <div>
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Sắp xếp</div>
                    <div className="space-y-1">
                      {sortOptions.map((o) => (
                        <button
                          key={o.key}
                          onClick={() => updateRouteSearch({ sort: o.key })}
                          className={cn(
                            'w-full text-left px-3 py-1.5 rounded-md text-sm transition-all duration-200',
                            routeSearch.sort === o.key
                              ? 'bg-blue-50 text-blue-700 font-medium '
                              : 'hover:bg-slate-100'
                          )}
                        >
                          <span className="mr-1.5">{o.icon}</span>
                          {o.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="pt-3 border-t">
                    <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Loại xe</div>
                    <div className="space-y-1.5">
                      {[
                        { key: 'limousine', label: 'Limousine', emoji: '🚐' },
                        { key: 'sleeper', label: 'Giường nằm', emoji: '🛏️' },
                        { key: 'standard', label: 'Ghế ngồi', emoji: '🚌' },
                      ].map((v) => {
                        const active = (routeSearch.vehicleTypes ?? []).includes(v.key)
                        const count = searchResults.filter((t) => (t.vehicleType ?? null) === v.key).length
                        return (
                          <label key={v.key} className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
                            <Checkbox
                              checked={active}
                              onCheckedChange={() => {
                                const next = active
                                  ? (routeSearch.vehicleTypes ?? []).filter((x) => x !== v.key)
                                  : [...(routeSearch.vehicleTypes ?? []), v.key]
                                updateRouteSearch({ vehicleTypes: next })
                              }}
                              className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                            />
                            <span className="group-hover:text-blue-700 transition-colors">{v.emoji} {v.label}</span>
                            {count > 0 && (
                              <span className="ml-auto text-xs text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{count}</span>
                            )}
                          </label>
                        )
                      })}
                    </div>
                  </div>

                  <FilterPanel
                    searchResults={searchResults}
                    filters={filters}
                    setFilters={setFilters}
                    priceBounds={priceBounds}
                    effectivePriceRange={effectivePriceRange}
                  />

                  {/* Quick stats */}
                  {searchResults.length > 0 && (
                    <div className="pt-3 border-t">
                      <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Tóm tắt</div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div className="flex items-center justify-between">
                          <span>Giá từ</span>
                          <span className="font-semibold text-blue-700">{formatCurrency(minPrice, currency)}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span>Nhiều chỗ nhất</span>
                          <span className="font-semibold">{maxAvail} chỗ</span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </aside>

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
                <Sheet open={mobileFilterOpen} onOpenChange={setMobileFilterOpen}>
                  <SheetTrigger asChild>
                    <Button variant="outline" size="sm" className="lg:hidden gap-1.5 relative">
                      <Filter className="h-3.5 w-3.5" />
                      Lọc
                      {activeFilterCount > 0 && (
                        <Badge className="bg-blue-600 text-white text-[9px] h-4 min-w-4 px-1 flex items-center justify-center absolute -top-1 -right-1">
                          {activeFilterCount}
                        </Badge>
                      )}
                    </Button>
                  </SheetTrigger>
                  <SheetContent side="left" className="w-[85vw] sm:max-w-md overflow-y-auto">
                    <SheetHeader>
                      <SheetTitle className="flex items-center gap-2">
                        <SlidersHorizontal className="h-4 w-4 text-blue-600" />
                        Bộ lọc
                        {activeFilterCount > 0 && (
                          <Badge className="bg-blue-600 text-white text-[10px]">{activeFilterCount}</Badge>
                        )}
                      </SheetTitle>
                    </SheetHeader>
                    <div className="px-4 pb-6 space-y-4">
                      <div>
                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Sắp xếp</div>
                        <div className="grid grid-cols-2 gap-1.5">
                          {sortOptions.map((o) => (
                            <button
                              key={o.key}
                              onClick={() => updateRouteSearch({ sort: o.key })}
                              className={cn(
                                'text-left px-3 py-1.5 rounded-md text-sm transition-all duration-200',
                                routeSearch.sort === o.key
                                  ? 'bg-blue-50 text-blue-700 font-medium border border-blue-300'
                                  : 'hover:bg-slate-100 border border-transparent'
                              )}
                            >
                              <span className="mr-1.5">{o.icon}</span>
                              {o.label}
                            </button>
                          ))}
                        </div>
                      </div>
                      <div className="pt-3 border-t">
                        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Loại xe</div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {[
                            { key: 'limousine', label: 'Limousine', emoji: '🚐' },
                            { key: 'sleeper', label: 'Giường nằm', emoji: '🛏️' },
                            { key: 'standard', label: 'Ghế ngồi', emoji: '🚌' },
                          ].map((v) => {
                            const active = (routeSearch.vehicleTypes ?? []).includes(v.key)
                            const count = searchResults.filter((t) => (t.vehicleType ?? null) === v.key).length
                            return (
                              <label key={v.key} className="flex items-center gap-2 cursor-pointer text-sm py-1 group">
                                <Checkbox
                                  checked={active}
                                  onCheckedChange={() => {
                                    const next = active
                                      ? (routeSearch.vehicleTypes ?? []).filter((x) => x !== v.key)
                                      : [...(routeSearch.vehicleTypes ?? []), v.key]
                                    updateRouteSearch({ vehicleTypes: next })
                                  }}
                                  className="data-[state=checked]:bg-blue-600 data-[state=checked]:border-blue-600"
                                />
                                <span className="group-hover:text-blue-700 transition-colors flex-1">{v.emoji} {v.label}</span>
                                {count > 0 && (
                                  <span className="text-xs text-muted-foreground bg-slate-100 rounded-full px-1.5 py-0.5">{count}</span>
                                )}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                      <FilterPanel
                        searchResults={searchResults}
                        filters={filters}
                        setFilters={setFilters}
                        priceBounds={priceBounds}
                        effectivePriceRange={effectivePriceRange}
                        isMobile
                      />
                      {activeFilterCount > 0 && (
                        <Button variant="outline" onClick={resetFilters} className="w-full text-rose-600 border-rose-300 hover:bg-rose-50">
                          <X className="h-4 w-4" /> Xoá tất cả bộ lọc
                        </Button>
                      )}
                    </div>
                  </SheetContent>
                </Sheet>
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
              <div



                className="overflow-hidden"
              >
                <div className="flex flex-wrap items-center gap-2">
                  {(effectivePriceRange[0] > priceBounds[0] || effectivePriceRange[1] < priceBounds[1]) && (
                    <FilterChip
                      label={`${formatCurrency(effectivePriceRange[0], currency)} - ${formatCurrency(effectivePriceRange[1], currency)}`}
                      onRemove={() => setFilters({ ...filters, priceMin: 0, priceMax: 0 })}
                    />
                  )}
                  {filters.timeRanges.map((r) => {
                    const opt = TIME_RANGE_OPTIONS.find((o) => o.key === r)
                    return (
                      <FilterChip
                        key={r}
                        label={opt?.label ?? r}
                        onRemove={() => setFilters({ ...filters, timeRanges: filters.timeRanges.filter((x) => x !== r) })}
                      />
                    )
                  })}
                  {filters.minRating > 0 && (
                    <FilterChip
                      label={`Đánh giá ${filters.minRating}+`}
                      icon={<Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
                      onRemove={() => setFilters({ ...filters, minRating: 0 })}
                    />
                  )}
                  {filters.availableOnly && (
                    <FilterChip
                      label="Còn> 5 chỗ"
                      onRemove={() => setFilters({ ...filters, availableOnly: false })}
                    />
                  )}
                  {filters.amenities.map((a) => {
                    const opt = AMENITY_OPTIONS.find((o) => o.key === a)
                    return (
                      <FilterChip
                        key={a}
                        label={opt?.label ?? a}
                        icon={opt?.icon}
                        onRemove={() => setFilters({ ...filters, amenities: filters.amenities.filter((x) => x !== a) })}
                      />
                    )
                  })}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={resetFilters}
                    className="h-7 text-xs text-rose-600 hover:text-rose-700 hover:bg-rose-50 px-2"
                  >
                    Xoá tất cả
                  </Button>
                </div>
              </div>
            )}
            {/* Saved Searches (collapsible list) */}
            {savedSearches.length > 0 && (
              <div className="mb-3 rounded-xl border bg-rose-50/40 p-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-rose-700 mb-2">
                  <Bookmark className="h-3.5 w-3.5" />
                  Tìm kiếm đã lưu ({savedSearches.length})
                </div>
                <div className="flex flex-wrap gap-1.5 max-h-24 overflow-y-auto">
                  {savedSearches.slice(0, 6).map((s) => (
                    <div
                      key={s.id}
                      className="inline-flex items-center gap-1.5 rounded-full border border-rose-200 bg-white px-2 py-1 text-[11px]"
                    >
                      <button
                        onClick={() => applySavedSearch(s)}
                        className="text-rose-700 font-medium hover:underline"
                      >
                        {s.from} → {s.to}
                      </button>
                      <span className="text-muted-foreground">• {s.date}</span>
                      <button
                        onClick={() => removeSavedSearch(s.id)}
                        className="text-muted-foreground hover:text-rose-600"
                        title="Xoá"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
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
            {searchLoading ? (
              <div className="space-y-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <TripCardSkeleton key={i} />
                ))}
              </div>
            ) : filteredResults.length === 0 ? (
              <div



                className="rounded-xl border bg-white p-10 text-center"
              >
                <AlertCircle className="h-10 w-10 text-amber-500 mx-auto mb-3" />
                <h3 className="font-semibold text-lg">
                  {searchResults.length === 0 ? 'Không tìm thấy chuyến' : 'Không có chuyến phù hợp bộ lọc'}
                </h3>
                <p className="text-sm text-muted-foreground mt-1">
                  {searchResults.length === 0
                    ? 'Thử đổi ngày đi, điểm đi/đến hoặc bỏ bớt bộ lọc loại xe.'
                    : 'Thử nới lỏng khoảng giá, đánh giá hoặc bỏ bớt bộ lọc tiện ích.'}
                </p>
                {searchResults.length > 0 && activeFilterCount > 0 && (
                  <Button onClick={resetFilters} variant="outline" className="mt-4 gap-1.5 border-blue-300 text-blue-700 hover:bg-blue-50">
                    <X className="h-4 w-4" />
                    Xoá tất cả bộ lọc
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {shouldVirtualize ? (
                  <div ref={listParentRef} className="max-h-[80vh] overflow-y-auto">
                    <div
                      style={{
                        height: `${virtualizer.getTotalSize()}px`,
                        position: 'relative',
                      }}
                    >
                      {virtualizer.getVirtualItems().map((virtualRow) => {
                        const t = filteredResults[virtualRow.index]
                        const isTopRated = t.brandRating === topRating
                        const isCheapest = t.minPrice === cheapestPrice
                        const isRecommended = virtualRow.index === 0 || (isTopRated && isCheapest)
                        return (
                          <div
                            key={t.tripId}
                            data-index={virtualRow.index}
                            ref={virtualizer.measureElement}
                            style={{
                              position: 'absolute',
                              top: 0,
                              left: 0,
                              width: '100%',
                              transform: `translateY(${virtualRow.start}px)`,
                            }}
                            className="pb-3"
                          >
                            <TripCard trip={t} onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })} index={virtualRow.index} isRecommended={filteredResults.length > 1 && isRecommended && virtualRow.index === 0} />
                          </div>
                        )
                      })}
                    </div>
                  </div>
                ) : (
                  <>
                    {filteredResults.map((t, i) => {
                      // Determine recommended: trip with highest rating AND lowest price in results
                      const isTopRated = t.brandRating === topRating
                      const isCheapest = t.minPrice === cheapestPrice
                      const isRecommended = i === 0 || (isTopRated && isCheapest)
                      return (
                        <TripCard key={t.tripId} trip={t} onSelect={() => navigate({ to: '/trips/$tripId', params: { tripId: t.tripId } })} index={i} isRecommended={filteredResults.length > 1 && isRecommended && i === 0} />
                      )
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

/* ─── Filter Chip ─── */

function FilterChip({ label, icon, onRemove }: { label: string; icon?: React.ReactNode; onRemove: () => void }) {
  return (
    <div



      className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-200 px-2.5 py-1 text-xs font-medium text-blue-700"
    >
      {icon}
      <span>{label}</span>
      <button
        onClick={onRemove}
        className="ml-0.5 rounded-full hover:bg-blue-200 p-0.5 transition-colors"
        aria-label={`Xoá bộ lọc ${label}`}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
