'use client'

/**
 * Disks metric card — mounted volumes with usage bars. React port of
 * pdf-tts's admin metrics Disks card.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { HardDrive } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { SystemMetricDisk } from '@/lib/queries'
import { formatBytes, usagePercent, usageTone } from './metric-helpers'

// ─── Disks ──────────────────────────────────────────────────────────

export function DisksCard({ disks }: { disks: SystemMetricDisk[] }) {
  return (
    <Card data-testid="metric-disks-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />
          Disks
        </CardTitle>
        <CardDescription>
          {disks.length} mounted volume{disks.length === 1 ? '' : 's'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {disks.length === 0 ? (
          <p className="text-sm text-muted-foreground">No mounted volumes reported.</p>
        ) : (
          <div className="space-y-4">
            {disks.map((disk) => {
              const pct = usagePercent(
                disk.totalBytes - disk.availableBytes,
                disk.totalBytes,
              );
              return (
                <div key={disk.mountPoint} className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <code className="text-sm font-medium">{disk.mountPoint}</code>
                      <Badge variant="secondary" className="text-[10px]">
                        {disk.fsType}
                      </Badge>
                      {disk.isRemovable && (
                        <Badge variant="outline" className="text-[10px]">
                          removable
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatBytes(disk.totalBytes - disk.availableBytes)} /{' '}
                      {formatBytes(disk.totalBytes)}{' '}
                      <span className={`font-medium ${usageTone(pct)}`}>
                        ({pct.toFixed(1)}%)
                      </span>
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {formatBytes(disk.availableBytes)} available
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
