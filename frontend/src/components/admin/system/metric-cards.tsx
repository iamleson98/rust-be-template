'use client'

/**
 * Metric cards for the admin Server Metrics section — React ports of
 * pdf-tts's `admin/metrics/*.svelte` cards (CPU, Memory, This Process,
 * Disks, Host). Same layout, thresholds and formatting; shadcn/ui
 * primitives + lucide icons instead of their Svelte equivalents.
 */

import { Cpu, HardDrive, LoaderCircle, MemoryStick, Server } from 'lucide-react'

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
import { barTone, formatBytes, formatUptime, usagePercent, usageTone } from './metric-helpers'

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
