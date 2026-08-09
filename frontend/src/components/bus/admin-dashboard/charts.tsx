'use client'

/**
 * Revenue / booking SVG charts for the AdminDashboard:
 *   - ForecastChart: 7-day forecast with confidence band (line+area)
 *   - BookingTrendsSparkline: 24h booking trends (bar chart)
 *
 * Extracted verbatim from the original `admin-dashboard.tsx`
 * (lines 1265-1561). Pure refactor.
 */

import { memo, useState } from 'react'

/* ─── Forecast Chart (SVG line + confidence band) ─── */

export const ForecastChart = memo(function ForecastChart({
  actual,
  forecast,
  lower,
  upper,
  actualLabels,
}: {
  actual: number[]
  forecast: number[]
  lower: number[]
  upper: number[]
  actualLabels: string[]
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const width = 560
  const height = 200
  const padding = { top: 16, right: 16, bottom: 28, left: 36 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom

  const all = [...actual, ...forecast, ...lower, ...upper]
  const maxY = Math.max(...all) * 1.15
  const minY = 0

  const total = actual.length + forecast.length
  const xFor = (i: number) => padding.left + (i / (total - 1)) * innerW
  const yFor = (v: number) => padding.top + innerH - ((v - minY) / (maxY - minY)) * innerH

  const actualPath = actual.map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(i)} ${yFor(v)}`).join(' ')
  const forecastPath = forecast
    .map((v, i) => `${i === 0 ? 'M' : 'L'} ${xFor(actual.length - 1 + i)} ${yFor(v)}`)
    .join(' ')

  // Confidence band: connect last actual to first forecast at the boundary
  const bandPoints = [
    ...forecast.map((_, i) => `${xFor(actual.length - 1 + i)},${yFor(upper[i])}`),
    ...forecast.map((_, i) => `${xFor(actual.length - 1 + forecast.length - 1 - i)},${yFor(lower[forecast.length - 1 - i])}`),
  ].join(' ')

  // Area fill under actual line
  const actualAreaPath = `${actualPath} L ${xFor(actual.length - 1)} ${yFor(minY)} L ${xFor(0)} ${yFor(minY)} Z`

  const next7Labels = ['T+1', 'T+2', 'T+3', 'T+4', 'T+5', 'T+6', 'T+7']
  const allLabels = [...actualLabels, ...next7Labels]
  const gridYs = [0, 0.25, 0.5, 0.75, 1].map((p) => padding.top + innerH - p * innerH)
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((p) => maxY * p)

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <defs>
          <linearGradient id="actualAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563eb" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#2563eb" stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Grid lines */}
        {gridYs.map((y, i) => (
          <line
            key={i}
            x1={padding.left}
            y1={y}
            x2={width - padding.right}
            y2={y}
            stroke="#e2e8f0"
            strokeWidth="1"
            strokeDasharray={i === 0 ? '0' : '3 3'}
          />
        ))}
        {/* Y-axis labels */}
        {gridVals.map((v, i) => (
          <text
            key={i}
            x={padding.left - 6}
            y={gridYs[i] + 3}
            textAnchor="end"
            fontSize="9"
            fill="#94a3b8"
          >
            {v.toFixed(0)}M
          </text>
        ))}

        {/* Confidence band */}
        <polygon points={bandPoints} fill="#2563eb" opacity="0.14" />

        {/* Actual area */}
        <path d={actualAreaPath} fill="url(#actualAreaGrad)" />

        {/* Actual line (solid) */}
        <path d={actualPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {/* Forecast line (dashed) */}
        <path d={forecastPath} fill="none" stroke="#2563eb" strokeWidth="2.5" strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />

        {/* Actual points */}
        {actual.map((v, i) => (
          <circle
            key={`a-${i}`}
            cx={xFor(i)}
            cy={yFor(v)}
            r={hoverIdx === i ? 4 : 3}
            fill="#2563eb"
            stroke="white"
            strokeWidth="1.5"
            className="transition-all"
          />
        ))}

        {/* Forecast points */}
        {forecast.map((v, i) => (
          <circle
            key={`f-${i}`}
            cx={xFor(actual.length + i)}
            cy={yFor(v)}
            r={hoverIdx === actual.length + i ? 4 : 2.5}
            fill="white"
            stroke="#2563eb"
            strokeWidth="2"
            className="transition-all"
          />
        ))}

        {/* Hover hit-areas */}
        {allLabels.map((_, i) => (
          <rect
            key={`hit-${i}`}
            x={xFor(i) - innerW / total / 2}
            y={padding.top}
            width={innerW / total}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        ))}

        {/* X-axis labels */}
        {allLabels.map((l, i) => (
          <text
            key={i}
            x={xFor(i)}
            y={height - 8}
            textAnchor="middle"
            fontSize="9"
            fill={i < actual.length ? '#64748b' : '#2563eb'}
            fontWeight={i === hoverIdx ? 700 : 400}
          >
            {l}
          </text>
        ))}

        {/* Divider line between actual and forecast */}
        <line
          x1={xFor(actual.length - 1)}
          y1={padding.top}
          x2={xFor(actual.length - 1)}
          y2={padding.top + innerH}
          stroke="#cbd5e1"
          strokeWidth="1"
          strokeDasharray="2 3"
        />

        {/* Hover tooltip */}
        {hoverIdx !== null && (
          (() => {
            const isActual = hoverIdx < actual.length
            const val = isActual ? actual[hoverIdx] : forecast[hoverIdx - actual.length]
            const x = xFor(hoverIdx)
            const y = yFor(val)
            const tipW = 80
            const tipH = 32
            const tipX = Math.max(padding.left, Math.min(width - padding.right - tipW, x - tipW / 2))
            const tipY = Math.max(padding.top, y - tipH - 8)
            return (
              <g pointerEvents="none">
                <line x1={x} y1={padding.top} x2={x} y2={padding.top + innerH} stroke="#2563eb" strokeWidth="1" strokeDasharray="2 2" opacity="0.5" />
                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="4" fill="#1e293b" />
                <text x={tipX + tipW / 2} y={tipY + 12} textAnchor="middle" fontSize="9" fill="#94a3b8">
                  {allLabels[hoverIdx]}
                </text>
                <text x={tipX + tipW / 2} y={tipY + 24} textAnchor="middle" fontSize="11" fontWeight="700" fill="white">
                  {val.toFixed(1)}M VND
                </text>
              </g>
            )
          })()
        )}
      </svg>
    </div>
  )
})

/* ─── Booking Trends Sparkline ─── */

export const BookingTrendsSparkline = memo(function BookingTrendsSparkline({ values, peakIdx }: { values: number[]; peakIdx: number }) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const width = 320
  const height = 80
  const padding = { top: 8, right: 8, bottom: 16, left: 8 }
  const innerW = width - padding.left - padding.right
  const innerH = height - padding.top - padding.bottom
  const maxY = Math.max(...values)

  const barW = innerW / values.length
  const yFor = (v: number) => padding.top + innerH - (v / maxY) * innerH

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fb923c" />
          </linearGradient>
          <linearGradient id="sparkPeak" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ef4444" />
            <stop offset="100%" stopColor="#f97316" />
          </linearGradient>
        </defs>
        {values.map((v, i) => {
          const isPeak = i === peakIdx
          const isHover = hoverIdx === i
          const x = padding.left + i * barW
          const y = yFor(v)
          const h = padding.top + innerH - y
          return (
            <g key={i}>
              <rect
                x={x + 1}
                y={y}
                width={Math.max(1, barW - 2)}
                height={Math.max(0, h)}
                rx="1.5"
                fill={isPeak ? 'url(#sparkPeak)' : 'url(#sparkGrad)'}
                opacity={isHover ? 1 : isPeak ? 0.95 : 0.7}
                className="transition-opacity"
              />
              <rect
                x={x}
                y={padding.top}
                width={barW}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHoverIdx(i)}
                onMouseLeave={() => setHoverIdx(null)}
              />
            </g>
          )
        })}
        {/* Peak label */}
        {(() => {
          const x = padding.left + peakIdx * barW + barW / 2
          const y = yFor(values[peakIdx])
          return (
            <g pointerEvents="none">
              <polygon points={`${x},${y - 12} ${x - 4},${y - 6} ${x + 4},${y - 6}`} fill="#ef4444" />
              <text x={x} y={y - 14} textAnchor="middle" fontSize="9" fontWeight="700" fill="#dc2626">
                {values[peakIdx]}
              </text>
            </g>
          )
        })()}
        {/* Hover tooltip */}
        {hoverIdx !== null && (
          (() => {
            const x = padding.left + hoverIdx * barW + barW / 2
            const v = values[hoverIdx]
            const tipW = 50
            const tipH = 22
            const tipX = Math.max(0, Math.min(width - tipW, x - tipW / 2))
            const tipY = 4
            return (
              <g pointerEvents="none">
                <rect x={tipX} y={tipY} width={tipW} height={tipH} rx="4" fill="#1e293b" />
                <text x={tipX + tipW / 2} y={tipY + 14} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">
                  {hoverIdx}h: {v} vé
                </text>
              </g>
            )
          })()
        )}
      </svg>
      {/* X-axis tick labels */}
      <div className="flex justify-between text-[9px] text-muted-foreground mt-0.5 px-1">
        <span>0h</span>
        <span>6h</span>
        <span>12h</span>
        <span>18h</span>
        <span>23h</span>
      </div>
    </div>
  )
})
