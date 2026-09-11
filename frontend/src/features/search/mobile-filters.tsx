'use client'

/**
 * MobileFiltersSheet — the mobile filter trigger button ("Lọc" with the
 * active-filter count badge) + the left-side Sheet with sort options,
 * vehicle-type checkboxes, the FilterPanel controls and the reset button.
 *
 * Extracted from the original `search-results.tsx`.
 */

import type { TripResult } from '@/lib/store'
import { SlidersHorizontal, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Sheet, SheetContent, SheetTrigger, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import { FilterPanel } from './filter-panel'
import { sortOptions, type Filters, type RouteSearch } from './helpers'

export function MobileFiltersSheet({
  mobileFilterOpen,
  setMobileFilterOpen,
  activeFilterCount,
  routeSearch,
  updateRouteSearch,
  searchResults,
  filters,
  setFilters,
  priceBounds,
  effectivePriceRange,
  resetFilters,
}: {
  mobileFilterOpen: boolean
  setMobileFilterOpen: (open: boolean) => void
  activeFilterCount: number
  routeSearch: RouteSearch
  updateRouteSearch: (changes: Partial<RouteSearch>) => void
  searchResults: TripResult[]
  filters: Filters
  setFilters: (f: Filters) => void
  priceBounds: [number, number]
  effectivePriceRange: [number, number]
  resetFilters: () => void
}) {
  return (
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
  )
}
