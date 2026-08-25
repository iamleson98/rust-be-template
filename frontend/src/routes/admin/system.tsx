/** Admin route — `/admin/system` — system monitoring dashboard. */
import { AdminShell } from '@/components/layout/admin-shell'
import { useSystemStatus } from '@/lib/queries'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Activity, Database, Wifi, Cpu, Clock, HardDrive, Server } from 'lucide-react'

export function AdminSystemPage() {
  const { data, isLoading } = useSystemStatus()

  if (isLoading) {
    return (
      <AdminShell>
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold mb-4">System Monitoring</h1>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      </AdminShell>
    )
  }

  if (!data) {
    return (
      <AdminShell>
        <div className="container mx-auto px-4 py-6 flex items-center justify-center">
          <p className="text-muted-foreground">Failed to load system status</p>
        </div>
      </AdminShell>
    )
  }

  const wsPct = data.websocket.maxConnections > 0
    ? Math.round((data.websocket.connections / data.websocket.maxConnections) * 100)
    : 0

  // Format memory with appropriate unit (MB or GB).
  const formatMem = (mb: number): string => {
    if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`
    return `${mb.toFixed(1)} MB`
  }

  return (
    <AdminShell>
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">System Monitoring</h1>

        {/* ── Top-row cards ────────────────────────────────────────── */}
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {/* Uptime */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Clock className="h-4 w-4" /> Uptime
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.uptime.human}</div>
              <div className="text-xs text-muted-foreground mt-1">
                {data.uptime.seconds.toLocaleString()} seconds since boot
              </div>
            </CardContent>
          </Card>

          {/* CPU + Memory (combined — both come from the process) */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Cpu className="h-4 w-4" /> CPU & Memory
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.process.cpuUsage.toFixed(1)}%</div>
              <div className="text-xs text-muted-foreground mt-1">
                CPU usage · {data.process.cpuCount} cores
              </div>
              <div className="mt-2 space-y-0.5 text-xs">
                <div className="flex items-center gap-1">
                  <Activity className="h-3 w-3" />
                  RSS: <span className="font-medium">{formatMem(data.process.memoryMb)}</span>
                </div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  Virtual: <span className="font-medium">{formatMem(data.process.virtualMemoryMb)}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* WebSocket */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Wifi className="h-4 w-4" /> WebSocket
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {data.websocket.connections}
                <span className="text-sm text-muted-foreground">
                  {' '}/ {data.websocket.maxConnections}
                </span>
              </div>
              <div className="flex items-center gap-2 mt-1">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${wsPct > 90 ? 'bg-red-500' : wsPct > 70 ? 'bg-amber-500' : 'bg-green-500'
                      }`}
                    style={{ width: `${Math.min(wsPct, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{wsPct}%</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                <div>Online staff: <span className="font-medium text-emerald-600">{data.websocket.onlineEmployees}</span></div>
                <div>Rooms: {data.websocket.rooms}</div>
                <div>Distinct IPs: {data.websocket.distinctIps}</div>
              </div>
            </CardContent>
          </Card>

          {/* Database */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Database className="h-4 w-4" /> Database
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold uppercase">{data.database.backend}</div>
              <div className="text-xs text-muted-foreground mt-1 truncate" title={data.database.urlMasked}>
                {data.database.urlMasked}
              </div>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                {data.database.activeConnections >= 0 ? (
                  <>
                    <div>Active: <span className="font-medium text-blue-600">{data.database.activeConnections}</span> · Idle: {data.database.idleConnections}</div>
                    <div>Pool: {data.database.minConnections}–{data.database.maxConnections} conns</div>
                  </>
                ) : (
                  <>
                    <div className="flex items-center gap-1">
                      <HardDrive className="h-3 w-3" />
                      Size: <span className="font-medium">{data.database.sizeMb.toFixed(2)} MB</span>
                    </div>
                    <div>Single connection (no pool)</div>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── OS / Host info ───────────────────────────────────────── */}
        <Card className="mt-4">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
              <Server className="h-4 w-4" /> Host Information
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">OS</div>
                <div className="font-medium">{data.process.osName}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">OS Version</div>
                <div className="font-medium">{data.process.osVersion}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Hostname</div>
                <div className="font-medium truncate">{data.process.hostname}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">PID</div>
                <div className="font-medium font-mono">{data.process.pid}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Auto-refresh indicator */}
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5 animate-pulse" />
          Auto-refreshing every 5 seconds
        </div>
      </div>
    </AdminShell>
  )
}
