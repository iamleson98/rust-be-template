'use client'

import { Bell, GitCompare, Heart } from 'lucide-react'
import type { TripResult } from '@/api'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import type { SearchParams } from '@/lib/search-params'
import { useUi } from '@/stores/ui'
import { MobileFilters } from './mobile-filters'
import type { ResultFilters } from './use-result-filters'

/** Save / track price / filter (phone) / compare buttons beside the results title. */
export function ResultsActions({
  search,
  results,
  rf,
  onSave,
}: {
  search: SearchParams
  results: TripResult[]
  rf: ResultFilters
  onSave: () => void
}) {
  const t = useT()
  const compareCount = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const openPriceAlert = useUi((s) => s.openPriceAlert)
  const cheapest = results.length ? Math.min(...results.map((r) => r.minPrice)) : 0

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="sm"
        onClick={onSave}
        disabled={results.length === 0}
        className="gap-1.5"
        title={t('searchPage.saveThisSearch')}
      >
        <Heart className="h-3.5 w-3.5 text-rose-500" />
        <span className="hidden sm:inline">{t('common.save')}</span>
      </Button>
      <Button
        variant="outline"
        size="sm"
        onClick={() =>
          openPriceAlert({ fromName: search.from, toName: search.to, minPrice: cheapest })
        }
        className="gap-1.5"
      >
        <Bell className="h-3.5 w-3.5 text-blue-600" />
        <span className="hidden sm:inline">{t('searchPage.trackPrice')}</span>
      </Button>
      <MobileFilters results={results} rf={rf} />
      {compareCount > 0 && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setCompareOpen(true)}
          className="gap-1.5 border-violet-300 text-violet-700 hover:bg-violet-50"
        >
          <GitCompare className="h-3.5 w-3.5" />
          {t('searchPage.compareCount', { count: compareCount })}
        </Button>
      )}
    </div>
  )
}
