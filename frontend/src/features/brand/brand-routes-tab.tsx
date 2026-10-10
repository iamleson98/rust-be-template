'use client'

import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import { EmptyState } from '@/components/console/panel'
import { ArrowRight, Calendar, Loader2, Route as RouteIcon, Search } from 'lucide-react'
import type { RouteOut } from '@/api'
import { useT } from '@/lib/i18n'

/** The brand's routes, each with its daily departures and a search shortcut. */
export function BrandRoutesTab({
  isLoading,
  routes,
  accent,
  onQuickSearch,
}: {
  isLoading: boolean
  routes: RouteOut[]
  accent: string
  onQuickSearch: (fromName: string, toName: string) => void
}) {
  const t = useT()
  return (
    <TabsContent value="routes" className="m-0 p-4">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="mb-2 size-6 animate-spin text-primary" />
          <p className="text-sm">{t('brandDetail.loadingRoutes')}</p>
        </div>
      ) : routes.length === 0 ? (
        <EmptyState
          icon={<RouteIcon />}
          text={
            <>
              <span className="block font-medium text-foreground">
                {t('brandDetail.noRoutesTitle')}
              </span>
              {t('brandDetail.noRoutesSubtitle')}
            </>
          }
        />
      ) : (
        <ul className="space-y-2.5">
          {routes.map((r) => (
            <li key={r.id} className="flex items-center gap-3 rounded-xl border bg-card p-3">
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{r.from.name}</span>
                  <ArrowRight className="size-3.5 shrink-0" style={{ color: accent }} />
                  <span className="truncate">{r.to.name}</span>
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Calendar className="size-3" />
                  {t('brandDetail.tripsPerDayCount', { count: r.scheduleCount })}
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="shrink-0"
                onClick={() => onQuickSearch(r.from.name, r.to.name)}
                aria-label={t('nav.searchTrips')}
              >
                <Search />
                <span className="hidden sm:inline">{t('nav.searchTrips')}</span>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </TabsContent>
  )
}
