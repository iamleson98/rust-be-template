'use client'

/**
 * Memory (host RAM) metric card — React port of pdf-tts's admin metrics
 * Memory card.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { MemoryStick } from 'lucide-react'

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import { formatBytes, usageTone } from './metric-helpers'

// ─── Memory ────────────────────────────────────────────────────────

export function MemoryCard({
  usagePercent: memPercent,
  usedBytes,
  totalBytes,
  availableBytes,
}: {
  usagePercent: number;
  usedBytes: number;
  totalBytes: number;
  availableBytes: number;
}) {
  return (
    <Card data-testid="metric-memory-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <MemoryStick className="h-4 w-4 text-muted-foreground" aria-hidden />
          Memory
        </CardTitle>
        <CardDescription>Host RAM utilization</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className={`text-3xl font-semibold tabular-nums ${usageTone(memPercent)}`}>
            {memPercent.toFixed(1)}%
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            {formatBytes(usedBytes)} / {formatBytes(totalBytes)}
          </span>
        </div>
        <Progress value={memPercent} className="h-2" />
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 pt-1 text-sm">
          <dt className="text-muted-foreground">Available</dt>
          <dd className="text-right tabular-nums">{formatBytes(availableBytes)}</dd>
        </dl>
      </CardContent>
    </Card>
  )
}
