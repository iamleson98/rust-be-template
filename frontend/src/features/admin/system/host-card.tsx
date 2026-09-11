'use client'

/**
 * Host metric card — hostname / OS / kernel / updated-at footer of the
 * Server Metrics section.
 *
 * Extracted from the original 'src/features/admin/system/metric-cards.tsx'.
 */

import { LoaderCircle } from 'lucide-react'

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

// ─── Host ───────────────────────────────────────────────────────────

export function HostCard({
  hostname,
  osName,
  kernelVersion,
  timestamp,
  refreshing = false,
}: {
  hostname: string;
  osName: string;
  kernelVersion: string;
  /** ISO timestamp of the current metrics snapshot. */
  timestamp: string;
  refreshing?: boolean;
}) {
  return (
    <Card data-testid="metric-host-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Host</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-muted-foreground">Hostname</dt>
            <dd className="font-medium">{hostname}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">OS</dt>
            <dd className="font-medium">{osName}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Kernel</dt>
            <dd className="font-medium truncate" title={kernelVersion}>
              {kernelVersion}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Updated</dt>
            <dd className="font-medium tabular-nums">
              {new Date(timestamp).toLocaleTimeString()}
              {refreshing && (
                <LoaderCircle
                  className="ml-1 inline h-3 w-3 animate-spin text-muted-foreground"
                  aria-hidden
                />
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  )
}
