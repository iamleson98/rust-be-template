'use client'

import { useState, useEffect, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Radar, RefreshCw } from 'lucide-react'
import { LiveTrackingMap } from './live-tracking-map'
import { LiveTrackingSidePanel } from './live-tracking-side-panel'
import type { TripDetail, TrackingStatus } from './live-tracking-types'

const STATUS_META: Record<
  TrackingStatus,
  { label: string; color: string; bg: string; dot: string }
> = {
  not_departed: {
    label: 'Chưa khởi hành',
    color: 'text-slate-700',
    bg: 'bg-slate-100',
    dot: 'bg-slate-400',
  },
  running: {
    label: 'Đang chạy',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    dot: 'bg-blue-500',
  },
  stopped: {
    label: 'Đang nghỉ',
    color: 'text-amber-700',
    bg: 'bg-amber-100',
    dot: 'bg-amber-500',
  },
  arriving_soon: {
    label: 'Sắp đến',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    dot: 'bg-blue-500',
  },
  arrived: {
    label: 'Đã đến',
    color: 'text-blue-700',
    bg: 'bg-blue-100',
    dot: 'bg-blue-500',
  },
}

export function LiveTracking({ detail }: { detail: TripDetail }) {
  // Tick state — updates every second for ETA countdown
  const [now, setNow] = useState(() => Date.now())
  // Speed state — fluctuates every few seconds (40-80 km/h)
  const [speed, setSpeed] = useState(58)
  // Last updated timestamp (updates every 5s)
  const [lastUpdated, setLastUpdated] = useState(() => Date.now())
  // Refreshing state for the refresh button
  const [refreshing, setRefreshing] = useState(false)
  // NOTE: the bus "bobbing" animation used to be driven by
  // requestAnimationFrame + setState (60 re-renders/sec). It is now a
  // declarative SVG <animateTransform> on the bus <g> — zero React
  // re-renders, runs entirely in the browser's SVG compositor.
  // (See the bus icon render below.)

  // Update `now` every 1s (drives ETA countdown + progress)
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [])

  // Update `lastUpdated` every 5s
  useEffect(() => {
    const t = setInterval(() => setLastUpdated(Date.now()), 5000)
    return () => clearInterval(t)
  }, [])

  // Update `speed` every 4s with small random walk (bounded 40-80)
  useEffect(() => {
    const t = setInterval(() => {
      setSpeed((prev) => {
        const delta = (Math.random() - 0.5) * 14
        return Math.max(40, Math.min(80, Math.round(prev + delta)))
      })
    }, 4000)
    return () => clearInterval(t)
  }, [])

  // Compute status + progress + derived values based on departure/arrival time
  const {
    status,
    progress,
    elapsedMin,
    etaSeconds,
    currentLocationName,
  } = useMemo(() => {
    const depTs = new Date(detail.trip.departureAt).getTime()
    const arrTs = new Date(detail.trip.arrivalAt).getTime()
    const nowTs = now

    let s: TrackingStatus
    let p: number

    if (nowTs >= arrTs) {
      s = 'arrived'
      p = 1
    } else if (nowTs >= depTs) {
      p = (nowTs - depTs) / (arrTs - depTs)
      const elapsed = (nowTs - depTs) / 60_000
      // Periodic stops: every ~2h, stop for ~10 min (realistic rest break)
      const stopInterval = 120
      const stopDuration = 10
      const phaseInCycle = elapsed % stopInterval
      const isStopped =
        phaseInCycle < stopDuration && p > 0.05 && p < 0.92
      if (p >= 0.92) s = 'arriving_soon'
      else if (isStopped) s = 'stopped'
      else s = 'running'
    } else {
      s = 'not_departed'
      p = 0
    }

    const elapsedM = Math.max(0, (nowTs - depTs) / 60_000)
    const etaSec = Math.max(0, Math.floor((arrTs - nowTs) / 1000))

    // Determine current location label based on which segment the bus is in
    let locName = detail.from.name
    if (s === 'arrived') {
      locName = detail.to.name
    } else if (s === 'not_departed') {
      locName = detail.from.name
    } else {
      const passedStops = detail.pickupPoints.filter(
        (pt) => pt.etaOffsetMin <= elapsedM
      )
      const nextStop = detail.pickupPoints.find(
        (pt) => pt.etaOffsetMin > elapsedM
      )
      if (passedStops.length > 0 && nextStop) {
        locName = `${passedStops[passedStops.length - 1].name} → ${nextStop.name}`
      } else if (nextStop) {
        locName = `${detail.from.name} → ${nextStop.name}`
      } else if (passedStops.length > 0) {
        locName = `Gần ${passedStops[passedStops.length - 1].name}`
      }
    }

    return {
      status: s,
      progress: p,
      elapsedMin: elapsedM,
      etaSeconds: etaSec,
      currentLocationName: locName,
    }
  }, [
    now,
    detail.trip.departureAt,
    detail.trip.arrivalAt,
    detail.pickupPoints,
    detail.from.name,
    detail.to.name,
  ])

  // Compute stop statuses for the list
  const stopsWithStatus = useMemo(() => {
    return detail.pickupPoints.map((p) => {
      let st: 'passed' | 'current' | 'upcoming'
      if (status === 'not_departed') st = 'upcoming'
      else if (status === 'arrived') st = 'passed'
      else {
        const diff = p.etaOffsetMin - elapsedMin
        if (diff < -2) st = 'passed'
        else if (diff <= 2) st = 'current'
        else st = 'upcoming'
      }
      return { ...p, status: st }
    })
  }, [status, elapsedMin, detail.pickupPoints])

  // Find next stop (first upcoming pickup point)
  const nextStop = useMemo(() => {
    if (status === 'arrived' || status === 'not_departed') return null
    return detail.pickupPoints.find((p) => p.etaOffsetMin > elapsedMin) ?? null
  }, [status, elapsedMin, detail.pickupPoints])

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => {
      setLastUpdated(Date.now())
      setSpeed(Math.max(40, Math.min(80, Math.round(50 + Math.random() * 30))))
      setRefreshing(false)
    }, 700)
  }

  const statusMeta = STATUS_META[status]

  // Relative "last updated" text
  const lastUpdatedText = (() => {
    const diff = Math.floor((now - lastUpdated) / 1000)
    if (diff < 5) return 'vừa xong'
    if (diff < 60) return `${diff} giây trước`
    return `${Math.floor(diff / 60)} phút trước`
  })()

  return (
    <div className="space-y-4">
      {/* Header: status badge + refresh */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2.5">
          <div
            className={`h-10 w-10 rounded-xl ${statusMeta.bg} ${statusMeta.color} flex items-center justify-center ring-1 ${statusMeta.bg.replace('bg-', 'ring-')}/40`}
          >
            <Radar className="h-5 w-5" />
          </div>
          <div>
            <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-semibold">
              Theo dõi trực tiếp
            </div>
            <div key={status}>
              <Badge className={`${statusMeta.bg} ${statusMeta.color} border-0 gap-1.5`}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${statusMeta.dot}`}
                />
                {statusMeta.label}
              </Badge>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRefresh}
          disabled={refreshing}
          className="gap-1.5"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? 'animate-spin' : ''}`} />
          {refreshing ? 'Đang cập nhật...' : 'Cập nhật vị trí'}
        </Button>
      </div>

      {/* Main grid: SVG map + side panel */}
      <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
        {/* SVG Map */}
        <LiveTrackingMap
          detail={detail}
          progress={progress}
          status={status}
          stopsWithStatus={stopsWithStatus}
          speed={speed}
          etaSeconds={etaSeconds}
          lastUpdatedText={lastUpdatedText}
          currentLocationName={currentLocationName}
        />

        {/* Side panel */}
        <LiveTrackingSidePanel
          detail={detail}
          nextStop={nextStop}
          status={status}
          now={now}
          stopsWithStatus={stopsWithStatus}
          elapsedMin={elapsedMin}
        />
      </div>

      {/* Progress bar */}
      <div className="rounded-xl border bg-white p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Tiến độ chuyến đi
          </div>
          <div className="text-sm font-bold text-blue-700">
            {Math.round(progress * 100)}%
          </div>
        </div>
        <Progress
          value={progress * 100}
          className="h-2.5 bg-slate-100 [&>div]:bg-linear-to-r [&>div]:from-blue-500 [&>div]:to-blue-500"
        />
        <div className="flex justify-between mt-1.5 text-[10px] text-muted-foreground">
          <span className="truncate max-w-[45%]">{detail.from.name}</span>
          <span className="truncate max-w-[45%] text-right">{detail.to.name}</span>
        </div>
      </div>
    </div>
  )
}
