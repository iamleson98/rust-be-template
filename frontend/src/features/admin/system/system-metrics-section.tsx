'use client'

/**
 * Server Metrics section — the admin `/admin/system` page's realtime
 * host monitor. React port of pdf-tts's `admin/server-metrics.svelte`:
 * polls `GET /api/admin/system/metrics` every 5 s (each scrape costs
 * the backend a ~200 ms CPU-sample window), renders the CPU / Memory /
 * This Process card row, the Disks card and the Host footer.
 *
 * Loading UX: while the FIRST snapshot loads the section renders a
 * structure-matched skeleton (`SystemMetricsSkeleton` — card-shaped
 * shimmer blocks mirroring the loaded layout), never a data table.
 * Errors render a red alert card with the backend's message.
 */

import { AlertCircle, RefreshCw, Server } from 'lucide-react'

import { SystemMetricsSkeleton } from '@/features/admin/system/system-metrics-skeleton'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { useSystemMetrics } from '@/lib/queries'
import { CpuCard } from './cpu-card'
import { DisksCard } from './disks-card'
import { HostCard } from './host-card'
import { MemoryCard } from './memory-card'
import { ProcessCard } from './process-card'

const POLL_SECONDS = 5;

export function SystemMetricsSection() {
  const metricsQuery = useSystemMetrics();

  return (
    <section id="server-metrics" data-testid="system-metrics" className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <Server className="h-5 w-5" aria-hidden />
          Server Metrics
          <span className="ml-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground">
            <RefreshCw
              className={`h-3 w-3 ${metricsQuery.isFetching ? 'animate-spin' : ''}`}
              aria-hidden
            />
            live · {POLL_SECONDS}s
          </span>
        </h2>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void metricsQuery.refetch()}
          disabled={metricsQuery.isFetching}
        >
          <RefreshCw
            className={`h-4 w-4 ${metricsQuery.isFetching ? 'animate-spin' : ''}`}
            aria-hidden
          />
          Refresh
        </Button>
      </div>

      {metricsQuery.isError ? (
        <Card data-testid="system-metrics-error">
          <CardContent className="flex items-center gap-3 pt-6 text-red-600">
            <AlertCircle className="h-5 w-5 shrink-0" aria-hidden />
            <div>
              <p className="font-medium">Failed to load server metrics</p>
              <p className="text-sm text-muted-foreground">
                {metricsQuery.error instanceof Error
                  ? metricsQuery.error.message
                  : 'Unknown error'}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : metricsQuery.isLoading ? (
        <SystemMetricsSkeleton />
      ) : metricsQuery.data ? (
        <div className="space-y-3">
          {/* CPU / Memory / This Process summary row */}
          <div className="grid gap-4 md:grid-cols-3">
            <CpuCard
              cpuUsagePercent={metricsQuery.data.cpuUsagePercent}
              logicalCores={metricsQuery.data.logicalCores}
              physicalCores={metricsQuery.data.physicalCores}
              perCoreUsagePercent={metricsQuery.data.perCoreUsagePercent}
            />
            <MemoryCard
              usagePercent={metricsQuery.data.memoryUsagePercent}
              usedBytes={metricsQuery.data.memoryUsedBytes}
              totalBytes={metricsQuery.data.memoryTotalBytes}
              availableBytes={metricsQuery.data.memoryAvailableBytes}
            />
            <ProcessCard
              processMemoryBytes={metricsQuery.data.processMemoryBytes}
              processCpuUsagePercent={metricsQuery.data.processCpuUsagePercent}
              uptimeSecs={metricsQuery.data.uptimeSecs}
            />
          </div>

          {/* Disks */}
          <DisksCard disks={metricsQuery.data.disks} />

          {/* Host info footer */}
          <HostCard
            hostname={metricsQuery.data.hostname}
            osName={metricsQuery.data.osName}
            kernelVersion={metricsQuery.data.kernelVersion}
            timestamp={metricsQuery.data.timestamp}
            refreshing={metricsQuery.isFetching}
          />
        </div>
      ) : null}
    </section>
  );
}
