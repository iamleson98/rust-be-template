'use client'

/**
 * CPU metric card — React port of pdf-tts's `admin/metrics` CPU card
 * (same layout, thresholds and formatting).
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { Cpu } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { barTone } from './metric-helpers'

// ─── CPU ───────────────────────────────────────────────────────────

export function CpuCard({
  cpuUsagePercent,
  logicalCores,
  physicalCores,
  perCoreUsagePercent,
}: {
  cpuUsagePercent: number;
  logicalCores: number;
  physicalCores: number;
  perCoreUsagePercent: number[];
}) {
  return (
    <Card data-testid="metric-cpu-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Cpu className="h-4 w-4 text-muted-foreground" aria-hidden />
          CPU
        </CardTitle>
        <CardDescription>
          {logicalCores} logical · {physicalCores} physical cores
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-3xl font-semibold tabular-nums">
            {cpuUsagePercent.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground">across all cores</span>
        </div>
        <Progress value={cpuUsagePercent} className="h-2" />
        {perCoreUsagePercent.length > 1 && (
          <div className="grid grid-cols-4 gap-1 pt-1 sm:grid-cols-6">
            {perCoreUsagePercent.map((core, i) => (
              <div key={i} className="flex flex-col items-center gap-0.5">
                <div
                  className="h-8 w-full overflow-hidden rounded-sm bg-muted"
                  title={`Core ${i}: ${core.toFixed(0)}%`}
                >
                  {/* Fill grows from the bottom like pdf-tts's mini bars. */}
                  <div
                    className={`w-full ${barTone(core)}`}
                    style={{ height: `${Math.max(core, 2)}%` }}
                  />
                </div>
                <span className="text-[10px] text-muted-foreground">
                  {core.toFixed(0)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
