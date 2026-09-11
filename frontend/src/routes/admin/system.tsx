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
 * table.
 */
import { Activity, Clock, Database, Wifi } from 'lucide-react'

import { DatabaseEngineSection } from '@/features/admin/system/database-engine-section'
import { SystemMetricsSection } from '@/features/admin/system/system-metrics-section'
import { SystemStatusSkeleton } from '@/features/admin/system/system-status-skeleton'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useSystemStatus } from '@/lib/queries'

export function AdminSystemPage() {
  const { data, isLoading } = useSystemStatus()

  return (
    <div className="page-transition container mx-auto px-4 py-6 space-y-8">
      <h1 className="text-2xl font-bold">System Monitoring</h1>

      {/* ── System Status (platform runtime) ───────────────────────── */}
      <section className="space-y-3" data-testid="system-status">
        <h2 className="text-lg font-semibold">System Status</h2>
        {isLoading ? (
          <SystemStatusSkeleton />
        ) : !data ? (
          <p className="text-sm text-muted-foreground">Failed to load system status</p>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            <UptimeCard data={data} />
            <WebSocketCard data={data} />
            <DatabaseCard data={data} />
          </div>
        )}
      </section>

      {/* ── Database Engine (memory / capacity / throughput) ──────── */}
      {data?.database?.engine && <DatabaseEngineSection engine={data.database.engine} />}

      {/* ── Server Metrics (host hardware, pdf-tts feature) ────────── */}
      <SystemMetricsSection />

      {/* Auto-refresh indicator */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Activity className="h-3.5 w-3.5 animate-pulse" aria-hidden />
        Auto-refreshing every 5 seconds
      </div>
    </div>
  )
}

/* ── System Status cards (from the previous page, minus the CPU &
 * Memory and Host info cards — superseded by the Server Metrics
 * section's CpuCard / ProcessCard / HostCard) ─────────────────── */

type StatusData = ReturnType<typeof useSystemStatus>['data']

function UptimeCard({ data }: { data: NonNullable<StatusData> }) {
  return (
    <Card data-testid="status-uptime-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden /> Uptime
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.uptime.human}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {data.uptime.seconds.toLocaleString()} seconds since boot
        </div>
      </CardContent>
    </Card>
  )
}

function WebSocketCard({ data }: { data: NonNullable<StatusData> }) {
  const ws = data.websocket
  const wsPct =
    ws.maxConnections > 0 ? Math.round((ws.connections / ws.maxConnections) * 100) : 0

  return (
    <Card data-testid="status-websocket-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Wifi className="h-4 w-4" aria-hidden /> WebSocket
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {ws.connections}
          <span className="text-sm text-muted-foreground"> / {ws.maxConnections}</span>
        </div>
        <div className="flex items-center gap-2 mt-1">
          <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden dark:bg-slate-800">
            <div
              className={`h-full rounded-full transition-all ${
                wsPct > 90 ? 'bg-red-500' : wsPct > 70 ? 'bg-amber-500' : 'bg-green-500'
              }`}
              style={{ width: `${Math.min(wsPct, 100)}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground">{wsPct}%</span>
        </div>
        <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
          <div>
            Online staff: <span className="font-medium text-emerald-600">{ws.onlineEmployees}</span>
          </div>
          <div>Rooms: {ws.rooms}</div>
          <div>Distinct IPs: {ws.distinctIps}</div>
        </div>
      </CardContent>
    </Card>
  )
}

function DatabaseCard({ data }: { data: NonNullable<StatusData> }) {
  const db = data.database
  const engine = db.engine

  return (
    <Card data-testid="status-database-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Database className="h-4 w-4" aria-hidden /> Database
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold uppercase">{db.backend}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate" title={db.urlMasked}>
          {db.urlMasked}
        </div>
        <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
          {db.activeConnections >= 0 ? (
            <>
              <div>
                Active: <span className="font-medium text-blue-600">{db.activeConnections}</span> ·
                Idle: {db.idleConnections}
              </div>
              <div>
                Pool: {db.minConnections}–{db.maxConnections} conns
              </div>
            </>
          ) : engine ? (
            <>
              <div>
                Size: <span className="font-medium">{db.sizeMb.toFixed(2)} MB</span>
                {engine.memory.dbSizeMb > 0 && (
                  <span className="text-muted-foreground">
                    {' '}
                    ({engine.memory.dbSizeMb.toFixed(2)} MB data)
                  </span>
                )}
              </div>
              <div>
                Engine connections:{' '}
                <span className="font-medium text-blue-600 tabular-nums">
                  {engine.connections.live}
                </span>{' '}
                · cache {engine.memory.cacheMb.toFixed(1)}/
                {engine.memory.cacheCapacityMb.toFixed(1)} MB
              </div>
              <div className="text-muted-foreground">
                See "Database Engine" below for memory · capacity · throughput
              </div>
            </>
          ) : (
            <>
              <div>Size: <span className="font-medium">{db.sizeMb.toFixed(2)} MB</span></div>
              <div>Single connection (no pool)</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
