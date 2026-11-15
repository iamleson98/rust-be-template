'use client'

/**
 * Database Engine section — the admin `/admin/system` page's card group
 * for the linked SQLite build.
 *
 * Renders `database.engine` from `GET /api/admin/system` (polled every
 * 5 s by the system-status query):
 *   • Build — the SQLite version and its source id (check-in time + hash).
 *   • Memory — SQLite's own heap now and its peak since boot (page
 *     caches, prepared statements, schema; not the process RSS).
 *
 * A value the server did not report is left out, never shown as 0.
 */

import type { EngineStatsOut } from '@/api'
import { Database, MemoryStick } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '@/lib/i18n'

/** A reported size: a finite, non-negative number. */
function isReported(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

const mb = (value: number) => `${value.toFixed(2)} MB`

export function DatabaseEngineSection({ engine }: { engine: EngineStatsOut }) {
  const t = useT()
  const { heapMb, heapPeakMb } = engine.memory
  const hasMemory = isReported(heapMb) || isReported(heapPeakMb)

  return (
    <section id="database-engine" data-testid="database-engine" className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Database className="h-5 w-5" aria-hidden />
        {t('adminSystem.dbEngineTitle')}
        {engine.sqliteVersion ? (
          <Badge variant="outline" className="font-normal">
            SQLite {engine.sqliteVersion}
          </Badge>
        ) : null}
      </h2>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {engine.version ? (
          <Card data-testid="engine-build-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Database className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('adminSystem.engineBuild')}
              </CardTitle>
              <CardDescription>{t('adminSystem.engineBuildDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <code className="block text-xs break-all text-muted-foreground">
                {engine.version}
              </code>
            </CardContent>
          </Card>
        ) : null}

        {hasMemory ? (
          <Card data-testid="engine-memory-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <MemoryStick className="h-4 w-4 text-muted-foreground" aria-hidden />
                {t('adminSystem.memory')}
              </CardTitle>
              <CardDescription>{t('adminSystem.memoryDesc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1">
              {isReported(heapMb) ? (
                <div className="flex items-baseline justify-between">
                  <span className="text-2xl font-semibold tabular-nums">{mb(heapMb)}</span>
                  <span className="text-xs text-muted-foreground">{t('adminSystem.heapNow')}</span>
                </div>
              ) : null}
              {isReported(heapPeakMb) ? (
                <div className="text-xs text-muted-foreground">
                  {t('adminSystem.heapPeak')}:{' '}
                  <span className="font-medium tabular-nums">{mb(heapPeakMb)}</span>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </section>
  )
}
