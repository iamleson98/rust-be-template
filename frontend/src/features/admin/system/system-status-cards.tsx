'use client'

/**
 * System Status cards (platform runtime): uptime, the WebSocket hub,
 * the audio-call subsystem (live sessions + janitor releases) and the
 * database (pool or embedded engine).
 *
 * From the previous page, minus the CPU & Memory and Host info cards —
 * superseded by the Server Metrics section's CpuCard / ProcessCard /
 * HostCard.
 *
 * Extracted from the original 'src/routes/admin/system.tsx'.
 */

import type { SystemStatusResponse } from '@/api'
import { Clock, Database, PhoneCall, Wifi } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useT } from '@/lib/i18n'

type StatusData = SystemStatusResponse

export function UptimeCard({ data }: { data: NonNullable<StatusData> }) {
  const t = useT()
  return (
    <Card data-testid="status-uptime-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Clock className="h-4 w-4" aria-hidden /> {t('adminSystem.uptime')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">{data.uptime.human}</div>
        <div className="text-xs text-muted-foreground mt-1">
          {t('adminSystem.uptimeSeconds', { count: data.uptime.seconds.toLocaleString() })}
        </div>
      </CardContent>
    </Card>
  )
}

export function WebSocketCard({ data }: { data: NonNullable<StatusData> }) {
  const t = useT()
  const ws = data.websocket
  const wsPct = ws.maxConnections > 0 ? Math.round((ws.connections / ws.maxConnections) * 100) : 0

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
            {t('adminSystem.onlineStaff')}:{' '}
            <span className="font-medium text-emerald-600">{ws.onlineEmployees}</span>
          </div>
          <div>
            {t('adminSystem.rooms')}: {ws.rooms}
          </div>
          <div>
            {t('adminSystem.distinctIps')}: {ws.distinctIps}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CallCard({ data }: { data: NonNullable<StatusData> }) {
  const t = useT()
  const calls = data.calls
  // Janitor counters: any release above zero means the SERVER had to
  // end a call no client hung up (frozen caller / dead call UI) — the
  // "resource auto release after call" safety net doing its job.
  const janitorTotal = (calls?.janitorRingExpired ?? 0) + (calls?.janitorActiveExpired ?? 0)

  return (
    <Card data-testid="status-call-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <PhoneCall className="h-4 w-4" aria-hidden /> {t('adminSystem.calls')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold">
          {calls?.sessions ?? 0}
          <span className="text-sm font-normal text-muted-foreground">
            {' '}
            {t('adminSystem.openSessions')}
          </span>
        </div>
        <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
          <div>
            {t('adminSystem.ringing')}:{' '}
            <span className="font-medium text-amber-600">{calls?.ringing ?? 0}</span> ·{' '}
            {t('adminSystem.inCall')}:{' '}
            <span className="font-medium text-emerald-600">{calls?.active ?? 0}</span>
          </div>
          <div>
            {t('adminSystem.agentSockets')}: {calls?.agentSockets ?? 0}
          </div>
          <div title={t('adminSystem.janitorHint')}>
            {t('adminSystem.janitor')}:{' '}
            {janitorTotal > 0 ? (
              <>
                <span className="font-medium tabular-nums">{janitorTotal}</span> (
                {t('adminSystem.janitorDetail', {
                  ring: calls?.janitorRingExpired ?? 0,
                  active: calls?.janitorActiveExpired ?? 0,
                })}
                )
              </>
            ) : (
              t('adminSystem.janitorClean')
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function DatabaseCard({ data }: { data: NonNullable<StatusData> }) {
  const t = useT()
  const db = data.database
  const engine = db.engine

  return (
    <Card data-testid="status-database-card">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2 text-muted-foreground">
          <Database className="h-4 w-4" aria-hidden /> {t('adminSystem.database')}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-lg font-semibold">{db.backend}</div>
        <div className="text-xs text-muted-foreground mt-1 truncate" title={db.urlMasked}>
          {db.urlMasked}
        </div>
        <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
          {db.activeConnections >= 0 ? (
            <>
              <div>
                {t('adminSystem.connActive')}:{' '}
                <span className="font-medium text-blue-600">{db.activeConnections}</span> ·{' '}
                {t('adminSystem.connIdle')}: {db.idleConnections}
              </div>
              <div>{t('adminSystem.pool', { min: db.minConnections, max: db.maxConnections })}</div>
            </>
          ) : engine ? (
            <>
              <div>
                {t('adminSystem.size')}:{' '}
                <span className="font-medium">{db.sizeMb.toFixed(2)} MB</span>
                {engine.memory.dbSizeMb > 0 && (
                  <span className="text-muted-foreground">
                    {' '}
                    (
                    {t('adminSystem.dataPart', { size: `${engine.memory.dbSizeMb.toFixed(2)} MB` })}
                    )
                  </span>
                )}
              </div>
              <div>
                {t('adminSystem.engineConnections')}:{' '}
                <span className="font-medium text-blue-600 tabular-nums">
                  {engine.connections.live}
                </span>{' '}
                · {t('adminSystem.cache')} {engine.memory.cacheMb.toFixed(1)}/
                {engine.memory.cacheCapacityMb.toFixed(1)} MB
              </div>
            </>
          ) : (
            <>
              <div>
                {t('adminSystem.size')}:{' '}
                <span className="font-medium">{db.sizeMb.toFixed(2)} MB</span>
              </div>
              <div>{t('adminSystem.singleConnection')}</div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
