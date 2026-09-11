'use client'

/**
 * "This Process" metric card — backend server resource use (RSS,
 * process CPU, uptime). React port of pdf-tts's admin metrics card.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { Server } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { formatBytes, formatUptime } from './metric-helpers'

// ─── This Process ──────────────────────────────────────────────────

export function ProcessCard({
  processMemoryBytes,
  processCpuUsagePercent,
  uptimeSecs,
}: {
  processMemoryBytes: number;
  processCpuUsagePercent: number;
  uptimeSecs: number;
}) {
  return (
    <Card data-testid="metric-process-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Server className="h-4 w-4 text-muted-foreground" aria-hidden />
          This Process
        </CardTitle>
        <CardDescription>Backend server resource use</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums">
            {formatBytes(processMemoryBytes)}
          </span>
          <span className="text-xs text-muted-foreground">resident (RSS)</span>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Process CPU</dt>
          <dd className="text-right tabular-nums">
            {processCpuUsagePercent.toFixed(1)}%
          </dd>
          <dt className="text-muted-foreground">Uptime</dt>
          <dd className="text-right tabular-nums">{formatUptime(uptimeSecs)}</dd>
        </dl>
        <p className="text-xs text-muted-foreground">
          Process CPU: 100% = one full core (values above 100% mean several
          cores are in use).
        </p>
      </CardContent>
    </Card>
  )
}
