'use client'

import { ArrowDownWideNarrow, Clock, Star, type LucideIcon } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { VEHICLE_TYPES } from '@/lib/vehicle-types'
import { toggle, count } from './filters'
import { cn } from '@/lib/utils'
import type { TripResult } from '@/api'
import type { SortKey } from '@/lib/search-params'
import { CheckRow, FilterSection } from './filter-ui'
import { useSearchUrl } from './use-search-url'

const SORTS: { key: SortKey; labelKey: string; Icon: LucideIcon }[] = [
  { key: 'departure', labelKey: 'searchPage.departureTime', Icon: Clock },
  { key: 'price', labelKey: 'searchPage.sortCheapest', Icon: ArrowDownWideNarrow },
  { key: 'rating', labelKey: 'searchPage.rating', Icon: Star },
]

/** Sort order, as a row of pills above the results (it lives in the URL and re-runs the query). */
export function SortTabs() {
  const t = useT()
  const { search, update } = useSearchUrl()
  return (
    <div
      role="radiogroup"
      aria-label={t('searchPage.sort')}
      className="flex min-w-0 gap-1.5 overflow-x-auto [scrollbar-width:none]"
    >
      {SORTS.map((o) => {
        const active = search.sort === o.key
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => update({ sort: o.key })}
            className={cn(
              'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors sm:px-3.5',
              active
                ? 'bg-slate-900 text-white'
                : 'bg-white text-slate-700 ring-1 ring-slate-200 hover:ring-slate-300',
            )}
          >
            {/* Phones: labels only, so all three fit beside the filter button. */}
            <o.Icon className="hidden size-3.5 sm:block" />
            {t(o.labelKey)}
          </button>
        )
      })}
    </div>
  )
}

/** Vehicle type: the filter that lives in the URL (and so re-runs the query). */
export function UrlFilters({ results }: { results: TripResult[] }) {
  const t = useT()
  const { search, update } = useSearchUrl()
  return (
    <FilterSection title={t('searchPage.vehicleType')} first>
      <div className="space-y-1.5">
        {VEHICLE_TYPES.map((v) => (
          <CheckRow
            key={v.key}
            checked={search.vehicleTypes.includes(v.key)}
            onChange={() => update({ vehicleTypes: toggle(search.vehicleTypes, v.key) })}
            icon={<v.Icon className="h-3.5 w-3.5" />}
            count={count(results, (r) => (r.vehicleType ?? null) === v.key)}
          >
            {t(v.labelKey)}
          </CheckRow>
        ))}
      </div>
    </FilterSection>
  )
}
