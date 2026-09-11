'use client'

// Extracted from the original 'live-tracking.tsx'.

import { useLiveTrackingProjection } from './live-tracking-projection'
import { LiveTrackingMapOverlays } from './live-tracking-map-overlays'
import type { TripDetail, TrackingStatus } from './live-tracking-types'

export function LiveTrackingMap({
  detail,
  progress,
  status,
  stopsWithStatus,
  speed,
  etaSeconds,
  lastUpdatedText,
  currentLocationName,
}: {
  detail: TripDetail
  progress: number
  status: TrackingStatus
  stopsWithStatus: (TripDetail['pickupPoints'][number] & { status: 'passed' | 'current' | 'upcoming' })[]
  speed: number
  etaSeconds: number
  lastUpdatedText: string
  currentLocationName: string
}) {
  const { points, viewBox, stops, pathD, busX, busY, traveledPathD, hasGeometry } =
    useLiveTrackingProjection(detail, progress)

  const accentColor = detail.brand.accentColor || '#2563eb'

  return (
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

      <LiveTrackingMapOverlays
        status={status}
        speed={speed}
        etaSeconds={etaSeconds}
        lastUpdatedText={lastUpdatedText}
        currentLocationName={currentLocationName}
      />
    </div>
  )
}
