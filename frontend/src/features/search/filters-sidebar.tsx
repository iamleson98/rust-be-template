'use client'

import { SlidersHorizontal } from 'lucide-react'
import type { TripResult } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatCurrency } from '@/lib/format'
import { useT } from '@/lib/i18n'
import { usePrefs } from '@/stores/prefs'
import { FilterSection } from './filter-ui'
import { FilterPanel } from './filter-panel'
import { UrlFilters } from './filter-controls'
import type { ResultFilters } from './use-result-filters'

/** Desktop (lg+) filter card: sort, vehicle type, the client filters and a quick summary. */
export function FiltersSidebar({ results, rf }: { results: TripResult[]; rf: ResultFilters }) {
  const t = useT()
  const currency = usePrefs((s) => s.currency)
  const cheapest = results.length ? Math.min(...results.map((r) => r.minPrice)) : 0
  const mostSeats = results.length ? Math.max(...results.map((r) => r.availableSeats)) : 0

  return (
    <aside className="hidden shrink-0 lg:block lg:w-80">
      <div className="space-y-4 lg:sticky lg:top-32">
        <div className="rounded-xl border bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="flex items-center gap-2 font-semibold">
              <SlidersHorizontal className="h-4 w-4 text-blue-600" />
              {t('searchPage.filters')}
              {rf.activeCount > 0 && (
                <Badge className="ml-1 flex h-5 min-w-5 items-center justify-center bg-blue-600 px-1 text-[10px] text-white">
                  {rf.activeCount}
                </Badge>
              )}
            </div>
            {rf.activeCount > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={rf.reset}
                className="h-7 text-xs text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              >
                {t('searchPage.clearAll')}
              </Button>
            )}
          </div>

          <div className="space-y-3">
            <UrlFilters results={results} />
            <FilterPanel results={results} rf={rf} />

            {results.length > 0 && (
              <FilterSection title={t('searchPage.summary')}>
                <div className="space-y-1 text-xs text-muted-foreground">
                  <div className="flex items-center justify-between">
                    <span>{t('common.fromPrice')}</span>
                    <span className="font-semibold text-blue-700">
                      {formatCurrency(cheapest, currency)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>{t('searchPage.mostSeats')}</span>
                    <span className="font-semibold">
                      {t('searchPage.seatsCount', { count: mostSeats })}
                    </span>
                  </div>
                </div>
              </FilterSection>
            )}
          </div>
        </div>
      </div>
    </aside>
  )
}
