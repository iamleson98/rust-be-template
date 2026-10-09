'use client'

import { Filter, SlidersHorizontal, X } from 'lucide-react'
import type { TripResult } from '@/api'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet'
import { useT } from '@/lib/i18n'
import { FilterPanel } from './filter-panel'
import { UrlFilters } from './filter-controls'
import type { ResultFilters } from './use-result-filters'

/** Phone filter button (with the active count) and the sheet it opens. */
export function MobileFilters({ results, rf }: { results: TripResult[]; rf: ResultFilters }) {
  const t = useT()
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-1.5 lg:hidden">
          <Filter className="h-3.5 w-3.5" />
          {t('searchPage.filter')}
          {rf.activeCount > 0 && (
            <Badge className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center bg-blue-600 px-1 text-[10px] text-white">
              {rf.activeCount}
            </Badge>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="left" className="w-[85vw] overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-blue-600" />
            {t('searchPage.filters')}
            {rf.activeCount > 0 && (
              <Badge className="bg-blue-600 text-[10px] text-white">{rf.activeCount}</Badge>
            )}
          </SheetTitle>
        </SheetHeader>
        <div className="space-y-4 px-4 pb-6">
          <UrlFilters results={results} grid />
          <FilterPanel results={results} rf={rf} mobile />
          {rf.activeCount > 0 && (
            <Button
              variant="outline"
              onClick={rf.reset}
              className="w-full border-rose-300 text-rose-600 hover:bg-rose-50"
            >
              <X className="h-4 w-4" /> {t('searchPage.clearAllFilters')}
            </Button>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
