/** Admin route — `/admin/system` — system monitoring dashboard.
 *
 * Three live sections (the first two poll every 5 s):
 *   • System Status — platform runtime: uptime, WebSocket hub, DB pool.
 *   • Database Engine — the rustqlite engine's own resource usage:
 *     memory used, performance capacity, throughput (+ per-file
 *     detail cards). Sourced from the engine's built-in counters.
 *   • Server Metrics — host hardware: CPU, RAM, disks, this process
 *     (the pdf-tts admin "Server Metrics" feature, ported 1:1).
 *
 * While data loads, each section renders a structure-matched skeleton
 * (`SystemStatusSkeleton` / `SystemMetricsSkeleton`) — never a data
 * table. The status cards live in
 * `src/features/admin/system/system-status-cards.tsx`; this file is
 * the thin page shell (data wiring + layout).
 */
import { useQuery } from '@tanstack/react-query'
import { systemStatusOptions } from '@/api'
import { Activity } from 'lucide-react'
import { ConsolePage, PageHeader } from '@/components/console/page'
import { useT } from '@/lib/i18n'

import { DatabaseEngineSection } from '@/features/admin/system/database-engine-section'
import { SystemMetricsSection } from '@/features/admin/system/system-metrics-section'
import { SystemStatusSkeleton } from '@/features/admin/system/system-status-skeleton'
import {
  CallCard,
  DatabaseCard,
  UptimeCard,
  WebSocketCard,
} from '@/features/admin/system/system-status-cards'

export function AdminSystemPage() {
  const t = useT()
  const { data, isLoading } = useQuery({ ...systemStatusOptions(), refetchInterval: 5000 })

  return (
    <ConsolePage>
      <PageHeader
        title={t('admin.systemMonitoring')}
        description={
          <span className="inline-flex items-center gap-1.5">
            <Activity className="size-3.5 animate-pulse" aria-hidden />
            {t('adminSystem.autoRefresh')}
          </span>
        }
      />

      {/* ── System Status (platform runtime) ───────────────────────── */}
      <section className="space-y-3" data-testid="system-status">
        <h2 className="text-lg font-semibold">{t('adminSystem.statusTitle')}</h2>
        {isLoading ? (
          <SystemStatusSkeleton />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">{t('adminSystem.statusLoadFailed')}</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
            <UptimeCard data={data} />
            <WebSocketCard data={data} />
            <CallCard data={data} />
            <DatabaseCard data={data} />
          </div>
        )}
      </section>

      {/* ── Database Engine (memory / capacity / throughput) ──────── */}
      {data?.database?.engine && <DatabaseEngineSection engine={data.database.engine} />}

      {/* ── Server Metrics (host hardware, pdf-tts feature) ────────── */}
      <SystemMetricsSection />
    </ConsolePage>
  )
}
