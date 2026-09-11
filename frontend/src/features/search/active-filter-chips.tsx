'use client'

/**
 * ActiveFilterChips — the row of removable chips summarising the active
 * filters (price range, departure time, rating, availability, amenities)
 * shown above the results list.
 *
 * Extracted from the original `search-results.tsx` together with the
 * private `FilterChip` it renders.
 */

import { useApp } from '@/lib/store'
import { Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/currency'
import { AMENITY_OPTIONS, TIME_RANGE_OPTIONS } from './filter-panel'
import type { Filters } from './helpers'

export function ActiveFilterChips({
  filters,
  setFilters,
  effectivePriceRange,
  priceBounds,
  resetFilters,
}: {
  filters: Filters
  setFilters: (f: Filters) => void
  effectivePriceRange: [number, number]
  priceBounds: [number, number]
  resetFilters: () => void
}) {
  const { currency } = useApp()
  return (
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
