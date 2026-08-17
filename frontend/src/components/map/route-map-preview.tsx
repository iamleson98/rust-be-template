'use client'

import { useMemo } from 'react'
import { formatDuration } from '@/lib/types'
import { MapPin, Navigation } from 'lucide-react'

type Props = {
  geometry: [number, number][] // [lat, lon][]
  pickupPoints: {
    id: string
    name: string
    stopOrder: number
    etaOffsetMin: number
    lat: number
    lon: number
    pickupType: string
  }[]
  fromName: string
  toName: string
  accentColor: string
}

// A stylized SVG map preview (no external map library needed).
// Projects lat/lon into an SVG viewBox preserving aspect ratio.
export function RouteMapPreview({ geometry, pickupPoints, fromName, toName, accentColor }: Props) {
  const { points, viewBox, stops } = useMemo(() => {
    const allPts = [...geometry, ...pickupPoints.map((p) => [p.lat, p.lon] as [number, number])]
    if (allPts.length === 0) {
      return { points: [], viewBox: '0 0 100 100', stops: [] }
    }
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
    const project = ([lat, lon]: [number, number]): [number, number] => {
      const x = pad + ((lon - minLon) / lonRange) * (W - 2 * pad)
      // invert lat (north = top)
      const y = pad + ((maxLat - lat) / latRange) * (H - 2 * pad)
      return [x, y]
    }
    const routePoints = geometry.map(project)
    const stopPts = pickupPoints.map((p) => ({
      ...p,
      xy: project([p.lat, p.lon]),
    }))
    return { points: routePoints, viewBox: `0 0 ${W} ${H}`, stops: stopPts }
  }, [geometry, pickupPoints])

  if (points.length < 2) {
    return <div className="text-sm text-muted-foreground p-4">Chưa có dữ liệu lộ trình.</div>
  }

  const pathD = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`)
    .join(' ')

  return (
    <div>
      <div className="rounded-xl overflow-hidden border bg-linear-to-br from-blue-50 to-blue-50 relative">
        <svg viewBox={viewBox} className="w-full h-auto block" style={{ background: 'linear-gradient(135deg, #ecfeff 0%, #f0fdf4 100%)' }}>
          {/* Grid lines */}
          <defs>
            <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#cbd5e1" strokeWidth="0.5" opacity="0.4" />
            </pattern>
            <linearGradient id="routeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor={accentColor} stopOpacity="0.4" />
              <stop offset="50%" stopColor={accentColor} stopOpacity="1" />
              <stop offset="100%" stopColor={accentColor} stopOpacity="0.4" />
            </linearGradient>
          </defs>
          <rect width="100%" height="100%" fill="url(#grid)" />

          {/* Route shadow */}
          <path d={pathD} fill="none" stroke={accentColor} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" opacity="0.15" transform="translate(2,2)" />
          {/* Route line */}
          <path d={pathD} fill="none" stroke="url(#routeGrad)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
          {/* Animated dot */}
          <circle r="5" fill={accentColor}>
            <animateMotion dur="6s" repeatCount="indefinite" path={pathD} />
            <animate attributeName="opacity" values="1;0.4;1" dur="1.5s" repeatCount="indefinite" />
          </circle>

          {/* Stops */}
          {stops.map((s, i) => {
            const isFirst = i === 0
            const isLast = i === stops.length - 1
            const [x, y] = s.xy
            return (
              <g key={s.id}>
                {(isFirst || isLast) && (
                  <circle cx={x} cy={y} r="14" fill={isFirst ? '#2563eb' : '#ef4444'} opacity="0.2">
                    <animate attributeName="r" values="10;16;10" dur="2s" repeatCount="indefinite" />
                  </circle>
                )}
                <circle
                  cx={x}
                  cy={y}
                  r={isFirst || isLast ? 8 : 5}
                  fill={isFirst ? '#2563eb' : isLast ? '#ef4444' : 'white'}
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
        </svg>

        {/* Overlay legend */}
        <div className="absolute top-3 left-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs font-medium flex items-center gap-2">
          <Navigation className="h-3.5 w-3.5 text-blue-600" />
          {fromName} → {toName}
        </div>
        <div className="absolute bottom-3 right-3 rounded-lg bg-white/90 backdrop-blur px-3 py-1.5 text-xs text-muted-foreground">
          {stops.length} trạm dừng
        </div>
      </div>

      {/* Stop list */}
      <div className="mt-4 space-y-1">
        <div className="text-xs font-semibold uppercase text-muted-foreground mb-2">Lịch trình chi tiết</div>
        {stops.map((s, i) => (
          <div key={s.id} className="flex items-center gap-3 py-1.5">
            <div className="flex flex-col items-center">
              <div
                className={`h-2.5 w-2.5 rounded-full ${
                  i === 0 ? 'bg-blue-500' : i === stops.length - 1 ? 'bg-rose-500' : 'bg-slate-300'
                }`}
              />
                {i < stops.length - 1 && <div className="w-px h-6 bg-slate-200" />}
            </div>
            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">{s.name}</div>
                <div className="text-[11px] text-muted-foreground capitalize">{s.pickupType.replace('_', ' ')}</div>
              </div>
              <div className="text-xs text-muted-foreground shrink-0 flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {formatDuration(s.etaOffsetMin)}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
