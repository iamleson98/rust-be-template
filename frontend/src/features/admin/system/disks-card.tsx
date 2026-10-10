'use client'

/**
 * Disks metric card — mounted volumes with usage bars. React port of
 * pdf-tts's admin metrics Disks card.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { HardDrive } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { DiskInfo } from '@/api'
import { formatBytes, usagePercent, usageTone } from './metric-helpers'
import { useT } from '@/lib/i18n'

// ─── Disks ──────────────────────────────────────────────────────────

export function DisksCard({ disks }: { disks: DiskInfo[] }) {
  const t = useT()
  return (
    <Card data-testid="metric-disks-card">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <HardDrive className="h-4 w-4 text-muted-foreground" aria-hidden />
          {t('adminSystem.disks')}
        </CardTitle>
        <CardDescription>{t('adminSystem.volumes', { count: disks.length })}</CardDescription>
      </CardHeader>
      <CardContent>
        {disks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('adminSystem.noVolumes')}</p>
        ) : (
          <div className="space-y-4">
            {disks.map((disk) => {
              const pct = usagePercent(disk.totalBytes - disk.availableBytes, disk.totalBytes)
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
                          {t('adminSystem.removable')}
                        </Badge>
                      )}
                    </div>
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatBytes(disk.totalBytes - disk.availableBytes)} /{' '}
                      {formatBytes(disk.totalBytes)}{' '}
                      <span className={`font-medium ${usageTone(pct)}`}>({pct.toFixed(1)}%)</span>
                    </span>
                  </div>
                  <Progress value={pct} className="h-2" />
                  <p className="text-xs text-muted-foreground">
                    {t('adminSystem.freeSpace', { size: formatBytes(disk.availableBytes) })}
                  </p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
