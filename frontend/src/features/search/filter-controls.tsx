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

/** The two filters that live in the URL (and so re-run the query). */
export function UrlFilters({ results, grid }: { results: TripResult[]; grid?: boolean }) {
  const t = useT()
  const { search, update } = useSearchUrl()
  return (
    <>
      <FilterSection title={t('searchPage.sort')} first>
        <div className={grid ? 'grid grid-cols-2 gap-1.5' : 'space-y-1'}>
          {SORTS.map((o) => (
            <button
              key={o.key}
              onClick={() => update({ sort: o.key })}
              className={cn(
                'flex items-center gap-2 rounded-md px-3 py-1.5 text-left text-sm transition-all duration-200',
                !grid && 'w-full',
                search.sort === o.key
                  ? cn('bg-blue-50 font-medium text-blue-700', grid && 'border border-blue-300')
                  : cn('hover:bg-slate-100', grid && 'border border-transparent'),
              )}
            >
              <o.Icon className="h-3.5 w-3.5 shrink-0" />
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title={t('searchPage.vehicleType')}>
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
    </>
  )
}
