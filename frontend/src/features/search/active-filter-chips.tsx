'use client'

import type { ReactNode } from 'react'
import { Star, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { usePrefs } from '@/stores/prefs'
import { AMENITIES, TIME_RANGES } from './filter-panel'
import type { ResultFilters } from './use-result-filters'

/** Removable chips for every active client filter, above the results. */
export function ActiveFilterChips({
  rf,
  brandNames,
}: {
  rf: ResultFilters
  /** slug → display name of the active brands. */
  brandNames: Record<string, string>
}) {
  const t = useT()
  const currency = usePrefs((s) => s.currency)
  const { filters, setFilters, range, bounds } = rf
  const set = (patch: Partial<typeof filters>) => setFilters({ ...filters, ...patch })
  const without = <T,>(list: T[], item: T) => list.filter((x) => x !== item)

  return (
    <div className="flex flex-wrap items-center gap-2 overflow-hidden">
      {filters.brands.map((slug) => (
        <FilterChip
          key={slug}
          label={brandNames[slug] ?? slug}
          onRemove={() => set({ brands: without(filters.brands, slug) })}
        />
      ))}
      {(range[0] > bounds[0] || range[1] < bounds[1]) && (
        <FilterChip
          label={`${formatCurrency(range[0], currency)} - ${formatCurrency(range[1], currency)}`}
          onRemove={() => set({ priceMin: 0, priceMax: 0 })}
        />
      )}
      {filters.timeRanges.map((r) => (
        <FilterChip
          key={r}
          label={t(TIME_RANGES.find((o) => o.key === r)?.labelKey ?? r)}
          onRemove={() => set({ timeRanges: without(filters.timeRanges, r) })}
        />
      ))}
      {filters.minRating > 0 && (
        <FilterChip
          label={t('searchPage.ratingPlus', { rating: filters.minRating })}
          icon={<Star className="h-3 w-3 fill-amber-400 text-amber-400" />}
          onRemove={() => set({ minRating: 0 })}
        />
      )}
      {filters.availableOnly && (
        <FilterChip
          label={t('searchPage.availableOnlyChip')}
          onRemove={() => set({ availableOnly: false })}
        />
      )}
      {filters.amenities.map((a) => {
        const option = AMENITIES.find((o) => o.key === a)
        return (
          <FilterChip
            key={a}
            label={option ? t(option.labelKey) : a}
            icon={option?.icon}
            onRemove={() => set({ amenities: without(filters.amenities, a) })}
          />
        )
      })}
      <Button
        variant="ghost"
        size="sm"
        onClick={rf.reset}
        className="h-7 px-2 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
      >
        {t('searchPage.clearAll')}
      </Button>
    </div>
  )
}

function FilterChip({
  label,
  icon,
  onRemove,
}: {
  label: string
  icon?: ReactNode
  onRemove: () => void
}) {
  const t = useT()
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700">
      {icon}
      <span>{label}</span>
      <button
        onClick={onRemove}
        className="-mr-1 ml-0.5 grid size-6 place-items-center rounded-full transition-colors hover:bg-blue-200"
        aria-label={t('searchPage.removeFilterAria', { label })}
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  )
}
