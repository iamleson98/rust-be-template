'use client'

import { GitCompare, Loader2, Sparkles, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import { useUi } from '@/stores/ui'
import { CompareTable } from './compare-table'
import { useCompareTrips } from './use-compare-trips'

/** Side-by-side comparison of up to three trips, as an overlay or (`inline`) the body of `/compare`. */
export function TripCompare({ inline = false }: { inline?: boolean }) {
  const t = useT()
  const compareList = useUi((s) => s.compareList)
  const compareOpen = useUi((s) => s.compareOpen)
  const setCompareOpen = useUi((s) => s.setCompareOpen)
  const clearCompare = useUi((s) => s.clearCompare)
  const { trips, loading } = useCompareTrips(compareList)

  // The page is always open; the overlay follows the store.
  if (!inline && !compareOpen) return null
  const close = () => setCompareOpen(false)

  return (
    <>
      {!inline && (
        <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={close} />
      )}
      <div
        className={cn(
          'flex flex-col overflow-hidden bg-background ring-1 ring-black/10 dark:ring-white/10',
          inline
            ? 'relative mx-auto max-h-[85dvh] w-full max-w-5xl rounded-2xl'
            : 'fixed inset-0 z-50 sm:inset-x-4 sm:bottom-8 sm:top-8 sm:m-auto sm:max-w-5xl sm:rounded-2xl',
        )}
      >
        <div className="flex items-center justify-between border-b bg-linear-to-r from-violet-600 to-fuchsia-600 px-4 py-3 text-white sm:px-6">
          <div className="flex items-center gap-2">
            <div className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
              <GitCompare className="h-4 w-4" />
            </div>
            <div>
              <div className="text-sm font-semibold">{t('searchPage.compareTrips')}</div>
              <div className="text-[10px] text-white/80">
                {t('searchPage.compareSubtitle', { count: trips.length })}
              </div>
            </div>
          </div>
          <button
            onClick={close}
            className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-white/15"
            aria-label={t('common.close')}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-violet-600" />
            </div>
          ) : compareList.length === 0 ? (
            <div className="p-12 text-center">
              <div className="mb-3 inline-flex h-14 w-14 items-center justify-center rounded-full bg-muted">
                <GitCompare className="h-7 w-7 text-muted-foreground" />
              </div>
              <h3 className="mb-1 font-semibold">{t('searchPage.compareEmptyTitle')}</h3>
              <p className="mx-auto max-w-sm text-sm text-muted-foreground">
                {t('searchPage.compareEmptyDesc')}
              </p>
            </div>
          ) : (
            <CompareTable trips={trips} onPick={close} />
          )}
        </div>

        <div className="flex items-center justify-between border-t bg-slate-50 px-4 py-2 sm:px-6">
          <Button variant="ghost" size="sm" onClick={clearCompare} disabled={trips.length === 0}>
            {t('searchPage.clearAll')}
          </Button>
          <div className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
            <Sparkles className="h-3 w-3 text-blue-500" />
            {t('searchPage.compareFooterNote')}
          </div>
        </div>
      </div>
    </>
  )
}
