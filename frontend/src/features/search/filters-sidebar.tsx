'use client'

/**
 * FiltersSidebar — the desktop (lg+) filter sidebar of the search-results
 * page: the sticky card with sort options, vehicle-type checkboxes, the
 * FilterPanel controls and the quick-stats summary.
 *
 * Extracted from the original `search-results.tsx`.
 */

import { useApp, type TripResult } from '@/lib/store'
import { SlidersHorizontal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { cn } from '@/lib/utils'
import { formatCurrency } from '@/lib/currency'
import { FilterPanel } from './filter-panel'
import { sortOptions, type Filters, type RouteSearch } from './helpers'

export function FiltersSidebar({
  routeSearch,
  updateRouteSearch,
  searchResults,
  filters,
  setFilters,
  priceBounds,
  effectivePriceRange,
  activeFilterCount,
  resetFilters,
  minPrice,
  maxAvail,
}: {
  routeSearch: RouteSearch
  updateRouteSearch: (changes: Partial<RouteSearch>) => void
  searchResults: TripResult[]
  filters: Filters
  setFilters: (f: Filters) => void
  priceBounds: [number, number]
  effectivePriceRange: [number, number]
  activeFilterCount: number
  resetFilters: () => void
  minPrice: number
  maxAvail: number
}) {
  const { currency } = useApp()
  return (
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
  )
}
