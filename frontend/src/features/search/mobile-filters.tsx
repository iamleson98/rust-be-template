import { useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import type { TripResult } from '@/api'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet'
import { useT } from '@/lib/i18n'
import { FilterPanel } from './filter-panel'
import { UrlFilters } from './filter-controls'
import type { ResultFilters } from './use-result-filters'

/**
 * Below lg: the Filter button (with how many are on) and the sheet it opens.
 * The sheet's footer says how many trips the filters leave and closes it.
 */
export function MobileFilters({ results, rf }: { results: TripResult[]; rf: ResultFilters }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:ring-slate-300 lg:hidden">
          <SlidersHorizontal className="size-3.5" />
          {t('searchPage.filter')}
          {rf.activeCount > 0 && (
            <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-[11px] font-bold text-primary-foreground">
              {rf.activeCount}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="flex w-[88vw] flex-col gap-0 p-0 sm:max-w-sm">
        <SheetHeader className="border-b px-5 py-4">
          <SheetTitle>{t('searchPage.filters')}</SheetTitle>
          <SheetDescription className="sr-only">{t('searchPage.filters')}</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4">
          <UrlFilters results={results} />
          <FilterPanel results={results} rf={rf} mobile />
        </div>
        <div className="flex gap-2 border-t bg-white px-5 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          {rf.activeCount > 0 && (
            <Button variant="outline" onClick={rf.reset} className="h-11 rounded-xl">
              {t('searchPage.clearAll')}
            </Button>
          )}
          <Button onClick={() => setOpen(false)} className="h-11 flex-1 rounded-xl">
            {t('searchPage.showTrips', { count: rf.filtered.length })}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  )
}
