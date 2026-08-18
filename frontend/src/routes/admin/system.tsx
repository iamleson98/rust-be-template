/** Admin route — `/admin/system` — system monitoring dashboard. */
import { useQuery } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Badge } from '@/components/ui/badge'
import { Activity, Database, Wifi, Cpu, Clock } from 'lucide-react'

type SystemStatus = {
  uptime: { seconds: number; human: string }
  websocket: {
    connections: number
    maxConnections: number
    rooms: number
    idempotencyEntries: number
    onlineEmployeeBrands: number
    distinctIps: number
  }
  database: {
    backend: string
    urlMasked: string
    maxConnections: number
    minConnections: number
  }
  process: {
    pid: number
    memoryMb: number
    cpuCount: number
  }
}

export function AdminSystemPage() {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'system'],
    queryFn: async () => {
      const res = await fetch('/api/admin/system', { credentials: 'include' })
      if (!res.ok) throw new Error('Failed to fetch system status')
      return res.json() as Promise<SystemStatus>
    },
    refetchInterval: 5000, // auto-refresh every 5s
  })

  if (isLoading) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
        <div className="container mx-auto px-4 py-6">
          <h1 className="text-2xl font-bold mb-4">System Monitoring</h1>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-40 w-full" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!data) {
    return (
      <div className="min-h-[calc(100vh-4rem)] bg-slate-50 flex items-center justify-center">
        <p className="text-muted-foreground">Failed to load system status</p>
      </div>
    )
  }

  const wsPct = data.websocket.maxConnections > 0
    ? Math.round((data.websocket.connections / data.websocket.maxConnections) * 100)
    : 0

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-slate-50">
      <div className="container mx-auto px-4 py-6">
        <h1 className="text-2xl font-bold mb-4">System Monitoring</h1>

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
                {data.uptime.seconds.toLocaleString()} seconds
              </div>
            </CardContent>
          </Card>

          {/* Memory */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
                <Activity className="h-4 w-4" /> Memory (RSS)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{data.process.memoryMb.toFixed(1)} MB</div>
              <div className="text-xs text-muted-foreground mt-1">
                PID: {data.process.pid} · {data.process.cpuCount} CPUs
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
                    className={`h-full rounded-full transition-all ${
                      wsPct > 90 ? 'bg-red-500' : wsPct > 70 ? 'bg-amber-500' : 'bg-green-500'
                    }`}
                    style={{ width: `${Math.min(wsPct, 100)}%` }}
                  />
                </div>
                <span className="text-xs text-muted-foreground">{wsPct}%</span>
              </div>
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                <div>Rooms: {data.websocket.rooms}</div>
                <div>Dedup cache: {data.websocket.idempotencyEntries}</div>
                <div>Online brands: {data.websocket.onlineEmployeeBrands}</div>
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
              <div className="text-xs text-muted-foreground mt-1 truncate">
                {data.database.urlMasked}
              </div>
              <div className="text-xs text-muted-foreground mt-2">
                Pool: {data.database.minConnections}–{data.database.maxConnections} conns
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Auto-refresh indicator */}
        <div className="mt-6 flex items-center gap-2 text-xs text-muted-foreground">
          <Cpu className="h-3.5 w-3.5 animate-pulse" />
          Auto-refreshing every 5 seconds
        </div>
      </div>
    </div>
  )
}
