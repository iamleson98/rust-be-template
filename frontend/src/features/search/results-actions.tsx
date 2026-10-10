import { Bell, GitCompare, Heart } from 'lucide-react'
import type { TripResult } from '@/api'
import { useT } from '@/lib/i18n'
import type { SearchParams } from '@/lib/search-params'
import { useUi } from '@/stores/ui'

const ICON_BUTTON =
  'inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3 text-sm font-medium text-slate-700 ring-1 ring-slate-200 transition-colors hover:ring-slate-300 disabled:opacity-50'

/** Save this search, watch the route's fares, open the comparison. */
export function ResultsActions({
  search,
  results,
  onSave,
}: {
  search: SearchParams
  results: TripResult[]
  onSave: () => void
}) {
  const t = useT()
  const compareCount = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const openPriceAlert = useUi((s) => s.openPriceAlert)
  const cheapest = results.length ? Math.min(...results.map((r) => r.minPrice)) : 0

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        onClick={onSave}
        disabled={results.length === 0}
        className={ICON_BUTTON}
        title={t('searchPage.saveThisSearch')}
        aria-label={t('searchPage.saveThisSearch')}
      >
        <Heart className="size-4 text-rose-500" />
        <span className="hidden md:inline">{t('common.save')}</span>
      </button>
      <button
        onClick={() =>
          openPriceAlert({ fromName: search.from, toName: search.to, minPrice: cheapest })
        }
        className={ICON_BUTTON}
        title={t('searchPage.trackPrice')}
        aria-label={t('searchPage.trackPrice')}
      >
        <Bell className="size-4 text-primary" />
        <span className="hidden md:inline">{t('searchPage.trackPrice')}</span>
      </button>
      {compareCount > 0 && (
        <button
          onClick={() => setCompareOpen(true)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full bg-violet-600 px-3.5 text-sm font-semibold text-white transition-colors hover:bg-violet-700"
        >
          <GitCompare className="size-4" />
          {t('searchPage.compareCount', { count: compareCount })}
        </button>
      )}
    </div>
  )
}
