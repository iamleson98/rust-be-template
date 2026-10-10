'use client'

import { GitCompare, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { useUi } from '@/stores/ui'

/** The "N/3 trips picked" bar above the results. */
export function CompareTray() {
  const t = useT()
  const count = useUi((s) => s.compareList.length)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const clear = useUi((s) => s.clearCompare)
  if (count === 0) return null

  return (
    <div className="mb-3 overflow-hidden">
      <div className="flex items-center gap-3 rounded-xl bg-linear-to-r from-violet-50 to-fuchsia-50 p-3 ring-1 ring-violet-200">
        <GitCompare className="h-4 w-4 shrink-0 text-violet-600" />
        <div className="flex-1 text-xs text-violet-700">
          <span className="font-semibold">{count}/3</span> {t('searchPage.compareSelected')}
        </div>
        <Button
          size="sm"
          className="h-7 gap-1 bg-violet-600 text-xs hover:bg-violet-700"
          onClick={() => setCompareOpen(true)}
        >
          {t('searchPage.compareNow')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="h-7 gap-1 text-xs text-violet-700 hover:bg-violet-100"
          onClick={clear}
        >
          <X className="h-3 w-3" />
          {t('common.delete')}
        </Button>
      </div>
    </div>
  )
}
