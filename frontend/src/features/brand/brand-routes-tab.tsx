'use client'

// Extracted from the original 'brand-detail-dialog.tsx'.

import { Button } from '@/components/ui/button'
import { TabsContent } from '@/components/ui/tabs'
import {
  Route as RouteIcon,
  Calendar,
  Navigation,
  ArrowRight,
  Loader2,
} from 'lucide-react'
import type { RouteOut } from '@/lib/api/types.gen'
import { useT } from '@/lib/i18n'
import { EmptyState } from './brand-dialog-parts'

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
    <TabsContent value="routes" className="p-4 m-0">
      {isLoading ? (
        <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin text-blue-600 mb-2" />
          <p className="text-sm">{t('brandDetail.loadingRoutes')}</p>
        </div>
      ) : routes.length === 0 ? (
        <EmptyState
          icon={<RouteIcon className="h-7 w-7 text-slate-400" />}
          title={t('brandDetail.noRoutesTitle')}
          subtitle={t('brandDetail.noRoutesSubtitle')}
        />
      ) : (
        <div className="space-y-2.5">
          {routes.map((r) => (
            <div
              key={r.id}
              className="group rounded-xl border bg-white hover:border-blue-400 transition-all p-3"
            >
              <div className="flex items-center gap-3">
                {/* Route name */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-semibold text-sm">
                    <span className="truncate">{r.from.name}</span>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-blue-600 shrink-0"
                      style={{ color: accent }}
                    />
                    <span className="truncate">{r.to.name}</span>
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {t('brandDetail.tripsPerDayCount', { count: r.scheduleCount })}
                    </span>
                  </div>
                </div>

                {/* Quick search button */}
                <Button
                  size="sm"
                  variant="outline"
                  className="shrink-0 gap-1 border-blue-300 text-blue-700 hover:bg-blue-600 hover:text-white hover:border-blue-600"
                  onClick={() => onQuickSearch(r.from.name, r.to.name)}
                >
                  <Navigation className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">{t('nav.searchTrips')}</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </TabsContent>
  )
}
