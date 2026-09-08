'use client'

/**
 * Database Engine section — the admin `/admin/system` page's deep-dive
 * into the rustqlite engine's own resource usage.
 *
 * Renders `database.engine` from `GET /api/admin/system` (polled every
 * 5 s by `useSystemStatus`):
 *   • Memory — page-cache footprint vs. capacity (+ WAL, DB size).
 *   • Performance Capacity — cache hit rate, live connections,
 *     write-slot contention (busy waits / timeouts).
 *   • Throughput — rows / writes / steps per second (live deltas
 *     between scrapes) + process-lifetime totals.
 *   • Per-file cards — one per registered engine (usually just the
 *     app DB): pages, cache, hit rate, WAL, connections, changes.
 *
 * The counters come from the engine's built-in atomics
 * (`sqlite3::engine_stats()`) — measuring them costs ~1 ns on the hot
 * path, so this observability is always-on, not sampled.
 */

import { Activity, Database, Gauge, MemoryStick } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Progress } from '@/components/ui/progress'
import type { SystemEngineStats } from '@/lib/queries'

/** Compact number: 12_400 → "12.4K", 3_500_000 → "3.5M". */
function compact(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '—'
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** Fixed-digits MB value. */
function mb(value: number, digits = 2): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  return `${value.toFixed(digits)} MB`
}

/** Rate with one decimal + "/s". */
function perSec(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '0'
  return `${compact(rate)}/s`
}

/** Hit-rate tone: high is GOOD (inverted vs. usage thresholds). */
function hitRateTone(pct: number): string {
  if (pct >= 95) return 'text-green-600'
  if (pct >= 80) return 'text-amber-600'
  return 'text-red-600'
}

function hitRateBarTone(pct: number): string {
  if (pct >= 95) return 'bg-green-500'
  if (pct >= 80) return 'bg-amber-500'
  return 'bg-red-500'
}

export function DatabaseEngineSection({ engine }: { engine: SystemEngineStats }) {
  const util = Math.min(Math.max(engine.memory.utilizationPct, 0), 100)
  const hitRate = Math.min(Math.max(engine.cache.hitRatePct, 0), 100)

  return (
    <section id="database-engine" data-testid="database-engine" className="space-y-3">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        <Database className="h-5 w-5" aria-hidden />
        Database Engine
        <Badge variant="outline" className="max-w-[280px] truncate font-normal" title={engine.version}>
          {engine.version.split(' ').slice(0, 2).join(' ')}
        </Badge>
      </h2>

      {/* ── Memory / Capacity / Throughput summary row ───────────── */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Memory */}
        <Card data-testid="engine-memory-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <MemoryStick className="h-4 w-4 text-muted-foreground" aria-hidden />
              Memory
            </CardTitle>
            <CardDescription>Page-cache footprint vs. capacity</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className="text-2xl font-semibold tabular-nums">
                {mb(engine.memory.cacheMb, 1)}
              </span>
              <span className="text-xs text-muted-foreground">
                of {mb(engine.memory.cacheCapacityMb, 1)}
              </span>
            </div>
            <Progress value={util} className="h-2" />
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
              <div>
                Cache utilization:{' '}
                <span className="font-medium tabular-nums">{util.toFixed(1)}%</span>
              </div>
              <div>
                DB size:{' '}
                <span className="font-medium tabular-nums">
                  {mb(engine.memory.dbSizeMb, 1)}
                </span>{' '}
                · WAL frames:{' '}
                <span className="font-medium tabular-nums">{compact(engine.memory.walFrames)}</span>
              </div>
              <div>
                Freelist pages:{' '}
                <span className="font-medium tabular-nums">
                  {compact(engine.memory.freelistPages)}
                </span>{' '}
                (reclaimable)
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Performance capacity */}
        <Card data-testid="engine-capacity-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Gauge className="h-4 w-4 text-muted-foreground" aria-hidden />
              Performance Capacity
            </CardTitle>
            <CardDescription>Cache hit rate · concurrency · contention</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-baseline justify-between">
              <span className={`text-2xl font-semibold tabular-nums ${hitRateTone(hitRate)}`}>
                {hitRate.toFixed(1)}%
              </span>
              <span className="text-xs text-muted-foreground">page-cache hit rate</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className={`h-full rounded-full transition-all ${hitRateBarTone(hitRate)}`}
                style={{ width: `${hitRate}%` }}
              />
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
              <div>
                Connections:{' '}
                <span className="font-medium text-blue-600 tabular-nums">
                  {engine.connections.live}
                </span>{' '}
                live · {compact(engine.cache.hits)} hits / {compact(engine.cache.misses)} misses
              </div>
              <div>
                Busy waits:{' '}
                <span
                  className={`font-medium tabular-nums ${engine.contention.busyWaits > 0 ? 'text-amber-600' : ''}`}
                >
                  {compact(engine.contention.busyWaits)}
                </span>{' '}
                · timeouts:{' '}
                <span
                  className={`font-medium tabular-nums ${engine.contention.busyTimeouts > 0 ? 'text-red-600' : ''}`}
                >
                  {compact(engine.contention.busyTimeouts)}
                </span>
              </div>
              <div className="flex items-center gap-1">
                Writer slot:
                {engine.transactions.active ? (
                  <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px]">
                    transaction active
                  </Badge>
                ) : (
                  <span>idle</span>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Throughput */}
        <Card data-testid="engine-throughput-card">
          <CardHeader className="pb-2">
            <CardTitle className="flex items-center gap-2 text-base">
              <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
              Throughput
            </CardTitle>
            <CardDescription>Live rate · lifetime totals (since boot)</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="grid grid-cols-3 gap-2">
              <div className="text-center">
                <div className="text-xl font-semibold tabular-nums">
                  {perSec(engine.throughput.rowsPerSec)}
                </div>
                <div className="text-[10px] text-muted-foreground">rows/s</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold tabular-nums">
                  {perSec(engine.throughput.writesPerSec)}
                </div>
                <div className="text-[10px] text-muted-foreground">writes/s</div>
              </div>
              <div className="text-center">
                <div className="text-xl font-semibold tabular-nums">
                  {perSec(engine.throughput.stepsPerSec)}
                </div>
                <div className="text-[10px] text-muted-foreground">steps/s</div>
              </div>
            </div>
            <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
              <div>
                Total rows returned:{' '}
                <span className="font-medium tabular-nums">
                  {compact(engine.throughput.rowsReturned)}
                </span>
              </div>
              <div>
                Writes executed:{' '}
                <span className="font-medium tabular-nums">
                  {compact(engine.throughput.writesExecuted)}
                </span>{' '}
                · statements: {compact(engine.throughput.statementsPrepared)}
              </div>
              <div>
                Row mutations (total_changes):{' '}
                <span className="font-medium tabular-nums">
                  {compact(engine.throughput.totalChanges)}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Per-file engine detail ─────────────────────────────────── */}
      {engine.files.length > 0 && (
        <div className="grid gap-4 md:grid-cols-2">
          {engine.files.map((f) => {
            const fHit = Math.min(Math.max(f.hitRatePct, 0), 100)
            return (
              <Card key={f.name} data-testid="engine-file-card">
                <CardHeader className="pb-2">
                  <CardTitle className="flex items-center gap-2 text-sm">
                    <Database className="h-4 w-4 text-muted-foreground shrink-0" aria-hidden />
                    <span className="truncate" title={f.name}>
                      {f.name.split('/').pop() || f.name}
                    </span>
                    {f.transactionActive && (
                      <Badge className="border-0 bg-emerald-100 text-emerald-700 text-[10px] shrink-0">
                        tx active
                      </Badge>
                    )}
                  </CardTitle>
                  <CardDescription className="truncate" title={f.name}>
                    {f.name}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">DB size</span>
                      <span className="font-medium tabular-nums">{mb(f.sizeMb, 2)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Pages</span>
                      <span className="font-medium tabular-nums">
                        {compact(f.pageCount)} × {formatPageSize(f.pageSizeBytes)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Cache</span>
                      <span className="font-medium tabular-nums">
                        {compact(f.cachePages)} / {compact(f.cacheCapacityPages)} pg (
                        {mb(f.cacheMb, 1)})
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Hit rate</span>
                      <span className={`font-medium tabular-nums ${hitRateTone(fHit)}`}>
                        {fHit.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">WAL frames</span>
                      <span className="font-medium tabular-nums">{compact(f.walFrames)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Connections</span>
                      <span className="font-medium tabular-nums">{f.liveConnections} live</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Freelist</span>
                      <span className="font-medium tabular-nums">
                        {compact(f.freelistPages)} pg
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Changes</span>
                      <span className="font-medium tabular-nums">
                        {compact(f.totalChanges)}
                      </span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* ── Transaction + connection ledger ─────────────────────────── */}
      <Card data-testid="engine-ledger-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Engine Ledger</CardTitle>
          <CardDescription>
            Process-lifetime transaction + connection accounting
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs sm:grid-cols-3 md:grid-cols-5">
          <LedgerItem label="Transactions begun" value={engine.transactions.begun} />
          <LedgerItem label="Committed" value={engine.transactions.committed} />
          <LedgerItem label="Rolled back" value={engine.transactions.rolledBack} />
          <LedgerItem label="Connections opened" value={engine.connections.opened} />
          <LedgerItem label="Connections closed" value={engine.connections.closed} />
        </CardContent>
      </Card>
    </section>
  )
}

function LedgerItem({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{compact(value)}</span>
    </div>
  )
}

function formatPageSize(bytes: number): string {
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)}KB`
  return `${bytes}B`
}
