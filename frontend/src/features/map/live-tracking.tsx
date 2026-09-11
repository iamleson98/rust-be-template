'use client'

import { useState, useEffect, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Separator } from '@/components/ui/separator'
import {
  Navigation,
  Radar,
  PhoneCall,
  Star,
  Gauge,
  MapPin,
  Clock,
  RefreshCw,
  CircleDot,
  CheckCircle2,
  Timer,
  Flag,
} from 'lucide-react'
import { formatDuration, formatTimeVN } from '@/lib/types'

// Minimal TripDetail type for live tracking (kept local to avoid circular imports)
type TripDetail = {
  trip: {
    id: string
    departureAt: string
    arrivalAt: string
    departureTime: string
    arrivalTime: string
    driverName: string | null
  }
  route: {
    id: string
    name: string
    geometry: [number, number][]
  }
  brand: {
    id: string
    name: string
    accentColor: string
    contactPhone: string | null
  }
  from: { name: string; lat: number; lon: number }
  to: { name: string; lat: number; lon: number }
  busLayout: {
    name: string
    capacity: number
    vehicleType: string
    vehicleTypeLabel: string
  }
  pickupPoints: {
    id: string
    name: string
    stopOrder: number
    etaOffsetMin: number
    lat: number
    lon: number
    pickupType: string
    address: string | null
  }[]
}

type TrackingStatus =
  | 'not_departed'
  | 'running'
  | 'stopped'
  | 'arriving_soon'
  | 'arrived'

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

// Deterministic hash for seed-based mock data
function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (s.charCodeAt(i) + ((h << 5) - h)) | 0
  }
  return Math.abs(h)
}

// Format seconds as HH:MM:SS countdown
function formatCountdown(sec: number): string {
  if (sec <= 0) return '00:00:00'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

// Find position at progress (0-1) along the path (pure function)
function positionAt(
  progress: number,
  points: [number, number][],
  totalLength: number,
  cumLengths: number[]
): [number, number] {
  if (points.length === 0) return [300, 180]
  if (progress <= 0) return points[0]
  if (progress >= 1) return points[points.length - 1]
  if (totalLength === 0) return points[0]
  const targetDist = progress * totalLength
  for (let i = 1; i < cumLengths.length; i++) {
    if (cumLengths[i] >= targetDist) {
      const segStart = cumLengths[i - 1]
      const segEnd = cumLengths[i]
      const segLen = segEnd - segStart
      if (segLen === 0) return points[i]
      const t = (targetDist - segStart) / segLen
      const [x1, y1] = points[i - 1]
      const [x2, y2] = points[i]
      return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)]
    }
  }
  return points[points.length - 1]
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

  // Project geometry (lat/lon) → SVG (x,y) coordinates
  const { points, viewBox, totalLength, cumLengths, stops, pathD } = useMemo(() => {
    const geometry = detail.route.geometry ?? []
    const pickupPoints = detail.pickupPoints ?? []
    if (!geometry || geometry.length === 0) {
      return {
        points: [] as [number, number][],
        viewBox: '0 0 600 360',
        totalLength: 0,
        cumLengths: [0],
        stops: [] as (TripDetail['pickupPoints'][number] & { xy: [number, number] })[],
        pathD: '',
      }
    }
    const allPts = [
      ...geometry,
      ...pickupPoints.map((p) => [p.lat, p.lon] as [number, number]),
    ]
    const lats = allPts.map((p) => p[0])
    const lons = allPts.map((p) => p[1])
    const minLat = Math.min(...lats)
    const maxLat = Math.max(...lats)
    const minLon = Math.min(...lons)
    const maxLon = Math.max(...lons)
    const latRange = Math.max(maxLat - minLat, 0.01)
    const lonRange = Math.max(maxLon - minLon, 0.01)

    const W = 600
    const H = 360
    const pad = 40
    const project = ([lat, lon]: [number, number]): [number, number] => [
      pad + ((lon - minLon) / lonRange) * (W - 2 * pad),
      pad + ((maxLat - lat) / latRange) * (H - 2 * pad),
    ]

    const routePoints = geometry.map(project)
    const stopPts = pickupPoints.map((p) => ({ ...p, xy: project([p.lat, p.lon]) }))

    // Cumulative segment lengths along the path
    const cumLengths = [0]
    let totalLength = 0
    for (let i = 1; i < routePoints.length; i++) {
      const dx = routePoints[i][0] - routePoints[i - 1][0]
      const dy = routePoints[i][1] - routePoints[i - 1][1]
      totalLength += Math.sqrt(dx * dx + dy * dy)
      cumLengths.push(totalLength)
    }

    const pathD = routePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ')

    return {
      points: routePoints,
      viewBox: `0 0 ${W} ${H}`,
      totalLength,
      cumLengths,
      stops: stopPts,
      pathD,
    }
  }, [detail.route.geometry, detail.pickupPoints])

  // Find position at progress (0-1) along the path (pure function)
  // (Moved outside the component as `positionAt`.)

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

  // Bus position on the SVG (interpolated along path based on progress)
  // Note: positionAt is a pure module-level function — calling it directly (no memo)
  // is cheap and avoids a React Compiler manual-memoization mismatch.
  const busPos = positionAt(progress, points, totalLength, cumLengths)
  const busX = busPos[0]
  const busY = busPos[1]

  // Traveled path (start → bus position)
  const traveledPathD = useMemo(() => {
    if (points.length < 2 || progress <= 0) return ''
    if (progress >= 1) return pathD
    const targetDist = progress * totalLength
    let endIdx = 1
    for (let i = 1; i < cumLengths.length; i++) {
      if (cumLengths[i] >= targetDist) {
        endIdx = i
        break
      }
    }
    const segPts = points.slice(0, endIdx + 1)
    segPts[segPts.length - 1] = busPos
    return segPts
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
      .join(' ')
  }, [points, progress, totalLength, cumLengths, busPos, pathD])

  const handleRefresh = () => {
    setRefreshing(true)
    setTimeout(() => {
      setLastUpdated(Date.now())
      setSpeed(Math.max(40, Math.min(80, Math.round(50 + Math.random() * 30))))
      setRefreshing(false)
    }, 700)
  }

  // Mock driver + vehicle data derived from trip id (deterministic)
  const seed = useMemo(() => hashString(detail.trip.id), [detail.trip.id])
  const driverName =
    detail.trip.driverName ??
    ['Nguyễn Văn Minh', 'Trần Quốc Bảo', 'Lê Hoàng Nam', 'Phạm Đức Anh'][seed % 4]
  const driverPhone = `09${String(10000000 + (seed % 89999999)).padStart(8, '0')}`
  const driverRating = (4.5 + (seed % 5) * 0.1).toFixed(1)
  const plateNumber = useMemo(() => {
    const regions = ['51A', '29A', '30A', '51B', '47A', '60C', '77A', '59A']
    const region = regions[seed % regions.length]
    const num = 10000 + (seed % 89999)
    return `${region}-${num}`
  }, [seed])

  const statusMeta = STATUS_META[status]
  const accentColor = detail.brand.accentColor || '#2563eb'

  // Relative "last updated" text
  const lastUpdatedText = (() => {
    const diff = Math.floor((now - lastUpdated) / 1000)
    if (diff < 5) return 'vừa xong'
    if (diff < 60) return `${diff} giây trước`
    return `${Math.floor(diff / 60)} phút trước`
  })()

  const hasGeometry = points.length >= 2

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
        <div className="rounded-xl overflow-hidden border bg-linear-to-br from-blue-50 to-blue-50 relative">
          {hasGeometry ? (
            <svg
              viewBox={viewBox}
              className="w-full h-auto block"
              style={{ background: 'linear-gradient(135deg, #ecfeff 0%, #f0fdf4 100%)' }}
            >
              <defs>
                <pattern id="lt-grid" width="40" height="40" patternUnits="userSpaceOnUse">
                  <path
                    d="M 40 0 L 0 0 0 40"
                    fill="none"
                    stroke="#cbd5e1"
                    strokeWidth="0.5"
                    opacity="0.4"
                  />
                </pattern>
                <linearGradient id="lt-traveled" x1="0%" y1="0%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#2563eb" stopOpacity="0.6" />
                  <stop offset="100%" stopColor="#2563eb" stopOpacity="1" />
                </linearGradient>
                <filter id="lt-bus-shadow" x="-50%" y="-50%" width="200%" height="200%">
                  <feDropShadow dx="0" dy="2" stdDeviation="2" floodOpacity="0.3" />
                </filter>
              </defs>
              <rect width="100%" height="100%" fill="url(#lt-grid)" />

              {/* Full route (light + dashed) */}
              {pathD && (
                <>
                  <path
                    d={pathD}
                    fill="none"
                    stroke={accentColor}
                    strokeWidth="6"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.15"
                    transform="translate(2,2)"
                  />
                  <path
                    d={pathD}
                    fill="none"
                    stroke={accentColor}
                    strokeWidth="3.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.3"
                    strokeDasharray="3 6"
                  />
                </>
              )}

              {/* Traveled portion (solid highlight) */}
              {traveledPathD && (
                <path
                  d={traveledPathD}
                  fill="none"
                  stroke="url(#lt-traveled)"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Stops */}
              {stops.map((s, i) => {
                const isFirst = i === 0
                const isLast = i === stops.length - 1
                const [x, y] = s.xy
                const stopStatus = stopsWithStatus[i]?.status
                const isCurrent = stopStatus === 'current'
                return (
                  <g key={s.id}>
                    {(isFirst || isLast || isCurrent) && (
                      <circle
                        cx={x}
                        cy={y}
                        r="14"
                        fill={isFirst ? '#2563eb' : isLast ? '#ef4444' : accentColor}
                        opacity="0.2"
                      >
                        <animate
                          attributeName="r"
                          values="10;16;10"
                          dur="2s"
                          repeatCount="indefinite"
                        />
                      </circle>
                    )}
                    <circle
                      cx={x}
                      cy={y}
                      r={isFirst || isLast ? 8 : 5}
                      fill={
                        stopStatus === 'passed'
                          ? isFirst
                            ? '#2563eb'
                            : isLast
                              ? '#ef4444'
                              : accentColor
                          : isCurrent
                            ? accentColor
                            : 'white'
                      }
                      stroke={isFirst ? '#059669' : isLast ? '#dc2626' : accentColor}
                      strokeWidth="2.5"
                    />
                    <text
                      x={x}
                      y={y - 14}
                      textAnchor="middle"
                      className="fill-slate-700"
                      style={{ fontSize: '13px', fontWeight: 600 }}
                    >
                      {s.name.length > 22 ? s.name.slice(0, 20) + '…' : s.name}
                    </text>
                  </g>
                )
              })}

              {/* Bus icon — bobbing via declarative SVG <animateTransform>
                  (no rAF, no React re-renders; runs in the SVG compositor). */}
              {points.length > 0 && (
                <g transform={`translate(${busX}, ${busY})`} filter="url(#lt-bus-shadow)">
                  <g>
                    {status === 'running' && (
                      <animateTransform
                        attributeName="transform"
                        type="translate"
                        values="0 0; 0 -1.5; 0 0"
                        dur="1.2s"
                        repeatCount="indefinite"
                        calcMode="spline"
                        keyTimes="0; 0.5; 1"
                        keySplines="0.4 0 0.6 1; 0.4 0 0.6 1"
                      />
                    )}
                    <circle
                      r="13"
                      fill="white"
                      stroke={accentColor}
                      strokeWidth="2.5"
                    />
                    <text
                      textAnchor="middle"
                      dy="5"
                      style={{ fontSize: '16px' }}
                      aria-label="Vị trí xe buýt"
                    >
                      🚌
                    </text>
                  </g>
                </g>
              )}
            </svg>
          ) : (
            <div className="p-12 text-center text-sm text-muted-foreground">
              Chưa có dữ liệu lộ trình để hiển thị vị trí xe.
            </div>
          )}

          {/* Overlay: speed + ETA (top-left) */}
          <div className="absolute top-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-2 flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <Gauge className="h-4 w-4 text-blue-600" />
              <div>
                <div className="text-[10px] text-muted-foreground leading-none">Tốc độ</div>
                <div className="font-bold text-sm leading-tight">
                  {status === 'running' || status === 'arriving_soon'
                    ? speed
                    : status === 'stopped'
                      ? '0'
                      : status === 'arrived'
                        ? '0'
                        : '—'}
                  <span className="text-[10px] font-normal text-muted-foreground ml-0.5">
                    km/h
                  </span>
                </div>
              </div>
            </div>
            <Separator orientation="vertical" className="h-7" />
            <div className="flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-amber-600" />
              <div>
                <div className="text-[10px] text-muted-foreground leading-none">
                  {status === 'arrived'
                    ? 'Đã đến'
                    : status === 'not_departed'
                      ? 'Khởi hành sau'
                      : 'Còn'}
                </div>
                <div className="font-bold text-sm font-mono leading-tight">
                  {status === 'arrived' ? '✓' : formatCountdown(etaSeconds)}
                </div>
              </div>
            </div>
          </div>

          {/* Overlay: last updated (bottom-right) */}
          <div className="absolute bottom-3 right-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground flex items-center gap-1.5">
            <Navigation className="h-3 w-3 text-blue-600" />
            <span>Cập nhật {lastUpdatedText}</span>
          </div>

          {/* Overlay: current location (bottom-left) */}
          {status !== 'arrived' && (
            <div className="absolute bottom-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs max-w-[60%]">
              <div className="text-[10px] text-muted-foreground leading-none mb-0.5">
                Vị trí hiện tại
              </div>
              <div className="font-medium text-slate-800 truncate flex items-center gap-1">
                <MapPin className="h-3 w-3 text-blue-600 shrink-0" />
                {currentLocationName}
              </div>
            </div>
          )}
        </div>

        {/* Side panel */}
        <div className="space-y-3">
          {/* Driver info */}
          <div className="rounded-xl border bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Thông tin tài xế
            </div>
            <div className="flex items-center gap-2.5">
              <div className="h-10 w-10 rounded-full bg-linear-to-br from-blue-100 to-blue-100 text-blue-700 inline-flex items-center justify-center font-bold shrink-0">
                {driverName.split(' ').slice(-1)[0]?.[0] ?? '?'}
              </div>
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-sm truncate">{driverName}</div>
                <div className="flex items-center gap-1 text-xs text-amber-600">
                  <Star className="h-3 w-3 fill-current" />
                  {driverRating}
                  <span className="text-muted-foreground ml-1">• 5+ năm KN</span>
                </div>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full mt-2.5 gap-1.5 text-xs h-8"
              asChild
            >
              <a href={`tel:${driverPhone}`}>
                <PhoneCall className="h-3.5 w-3.5" /> {driverPhone}
              </a>
            </Button>
          </div>

          {/* Bus info */}
          <div className="rounded-xl border bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Thông tin xe
            </div>
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Biển số</span>
                <span className="font-mono font-bold">{plateNumber}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Loại xe</span>
                <span className="font-medium">{detail.busLayout.vehicleTypeLabel}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Số chỗ</span>
                <span className="font-medium">{detail.busLayout.capacity} chỗ</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Đội xe</span>
                <span className="font-medium truncate ml-2">{detail.brand.name}</span>
              </div>
            </div>
          </div>

          {/* Next stop highlight */}
          {nextStop ? (
            <div
              key={nextStop.id}
              className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200 p-3"
            >
              <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold mb-1">
                Trạm dừng tiếp theo
              </div>
              <div className="font-bold text-sm text-blue-800 truncate flex items-center gap-1">
                <Flag className="h-3.5 w-3.5 shrink-0" />
                {nextStop.name}
              </div>
              <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                <span>
                  Đến sau{' '}
                  {(() => {
                    const depTs = new Date(detail.trip.departureAt).getTime()
                    const stopTs = depTs + nextStop.etaOffsetMin * 60_000
                    const secToStop = Math.max(0, Math.floor((stopTs - now) / 1000))
                    return formatCountdown(secToStop)
                  })()}
                </span>
              </div>
            </div>
          ) : (
            <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
                {status === 'arrived' ? 'Trạm đến' : 'Trạm xuất phát'}
              </div>
              <div className="font-bold text-sm text-slate-800 truncate flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5 shrink-0" />
                {status === 'arrived' ? detail.to.name : detail.from.name}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {status === 'arrived'
                  ? `Đã đến lúc ${formatTimeVN(detail.trip.arrivalAt)}`
                  : `Khởi hành lúc ${formatTimeVN(detail.trip.departureAt)}`}
              </div>
            </div>
          )}

          {/* Stop list with statuses */}
          <div className="rounded-xl border bg-white p-3">
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
              Lịch trình các trạm
            </div>
            <div className="space-y-0 max-h-72 overflow-y-auto pr-1 custom-scroll">
              {stopsWithStatus.map((s, i) => {
                const isCurrent = s.status === 'current'
                const isPassed = s.status === 'passed'
                const isLast = i === stopsWithStatus.length - 1
                return (
                  <div key={s.id} className="flex items-start gap-2">
                    <div className="flex flex-col items-center pt-0.5">
                      {isPassed ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                      ) : isCurrent ? (
                        <CircleDot className="h-3.5 w-3.5 text-blue-600" />
                      ) : (
                        <div className="h-3 w-3 rounded-full border-2 border-slate-300" />
                      )}
                      {!isLast && <div className="w-px h-5 bg-slate-200 mt-0.5" />}
                    </div>
                    <div className="flex-1 min-w-0 pb-1.5">
                      <div
                        className={`text-xs font-medium truncate ${
                          isPassed
                            ? 'text-slate-500 line-through'
                            : isCurrent
                              ? 'text-blue-700'
                              : 'text-slate-700'
                        }`}
                      >
                        {s.name}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {isPassed
                          ? 'Đã đi qua'
                          : isCurrent
                            ? 'Đang tại đây'
                            : `Còn ${formatDuration(Math.max(0, s.etaOffsetMin - elapsedMin))}`}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
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
