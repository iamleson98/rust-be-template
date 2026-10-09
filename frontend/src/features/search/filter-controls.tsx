'use client'

import { useT } from '@/lib/i18n'
import { toggle, count } from './filters'
import { cn } from '@/lib/utils'
import type { TripResult } from '@/api'
import type { SortKey } from '@/lib/search-params'
import { CheckRow, FilterSection } from './filter-ui'
import { useSearchUrl } from './use-search-url'

const SORTS: { key: SortKey; labelKey: string; icon: string }[] = [
  { key: 'departure', labelKey: 'searchPage.departureTime', icon: '🕐' },
  { key: 'price', labelKey: 'searchPage.sortCheapest', icon: '💰' },
  { key: 'rating', labelKey: 'searchPage.rating', icon: '⭐' },
]

const VEHICLES = [
  { key: 'limousine', labelKey: 'searchPage.vehicleLimousine', emoji: '🚐' },
  { key: 'sleeper', labelKey: 'searchPage.vehicleSleeper', emoji: '🛏️' },
  { key: 'semi_sleeper', labelKey: 'searchPage.vehicleSemiSleeper', emoji: '🛌' },
  { key: 'minivan', labelKey: 'searchPage.vehicleMinivan', emoji: '🚐' },
  { key: 'standard', labelKey: 'searchPage.vehicleStandard', emoji: '🚌' },
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
                'rounded-md px-3 py-1.5 text-left text-sm transition-all duration-200',
                !grid && 'w-full',
                search.sort === o.key
                  ? cn('bg-blue-50 font-medium text-blue-700', grid && 'border border-blue-300')
                  : cn('hover:bg-slate-100', grid && 'border border-transparent'),
              )}
            >
              <span className="mr-1.5">{o.icon}</span>
              {t(o.labelKey)}
            </button>
          ))}
        </div>
      </FilterSection>

      <FilterSection title={t('searchPage.vehicleType')}>
        <div className="space-y-1.5">
          {VEHICLES.map((v) => (
            <CheckRow
              key={v.key}
              checked={search.vehicleTypes.includes(v.key)}
              onChange={() => update({ vehicleTypes: toggle(search.vehicleTypes, v.key) })}
              count={count(results, (r) => (r.vehicleType ?? null) === v.key)}
            >
              {v.emoji} {t(v.labelKey)}
            </CheckRow>
          ))}
        </div>
      </FilterSection>
    </>
  )
}
