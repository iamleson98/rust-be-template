import { SlidersHorizontal } from 'lucide-react'
import type { TripResult } from '@/api'
import { useT } from '@/lib/i18n'
import { FilterPanel } from './filter-panel'
import { UrlFilters } from './filter-controls'
import type { ResultFilters } from './use-result-filters'

/** Desktop (lg+) filters beside the results, kept in view while scrolling. */
export function FiltersSidebar({ results, rf }: { results: TripResult[]; rf: ResultFilters }) {
  const t = useT()
  return (
    <aside className="hidden w-72 shrink-0 lg:block">
      <div className="sticky top-[calc(var(--header-h)+5.5rem)] rounded-2xl bg-white p-5 shadow-soft ring-1 ring-slate-200/80">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2 font-semibold text-slate-900">
            <SlidersHorizontal className="size-4 text-primary" />
            {t('searchPage.filters')}
            {rf.activeCount > 0 && (
              <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
                {rf.activeCount}
              </span>
            )}
          </div>
          {rf.activeCount > 0 && (
            <button
              onClick={rf.reset}
              className="text-xs font-semibold text-primary hover:underline"
            >
              {t('searchPage.clearAll')}
            </button>
          )}
        </div>
        <div className="space-y-4">
          <UrlFilters results={results} />
          <FilterPanel results={results} rf={rf} />
        </div>
      </div>
    </aside>
  )
}
