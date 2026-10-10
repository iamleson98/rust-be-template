'use client'

/**
 * "This Process" metric card — backend server resource use (RSS,
 * process CPU, uptime). React port of pdf-tts's admin metrics card.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { Server } from 'lucide-react'

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { formatBytes, formatUptime } from './metric-helpers'
import { useT } from '@/lib/i18n'

// ─── This Process ──────────────────────────────────────────────────

export function ProcessCard({
  processMemoryBytes,
  processCpuUsagePercent,
  uptimeSecs,
}: {
  processMemoryBytes: number
  processCpuUsagePercent: number
  uptimeSecs: number
}) {
  const t = useT()
  return (
    <Card data-testid="metric-process-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('adminSystem.process')}
        </CardTitle>
        <CardDescription>{t('adminSystem.processDesc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums">
            {formatBytes(processMemoryBytes)}
          </span>
          <span className="text-xs text-muted-foreground">{t('adminSystem.rss')}</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">{t('adminSystem.processCpu')}</dt>
          <dd className="text-right tabular-nums">{processCpuUsagePercent.toFixed(1)}%</dd>
          <dt className="text-muted-foreground">{t('adminSystem.uptime')}</dt>
          <dd className="text-right tabular-nums">{formatUptime(uptimeSecs)}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">{t('adminSystem.processCpuNote')}</p>
      </CardContent>
    </Card>
  )
}
