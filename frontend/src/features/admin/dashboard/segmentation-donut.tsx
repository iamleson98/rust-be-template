'use client'

/**
 * Customer Segmentation Donut
 * Generic version — accepts segments with `{ label, count, color }` so it
 * can be driven by real backend data (e.g. booking status breakdown)
 * instead of the deleted `CUSTOMER_SEGMENTS` mock array.
 *
 * Extracted from the original 'src/features/admin/dashboard/badges.tsx'.
 */

import { useState } from 'react'
import { formatNum } from '@/lib/types'

export type DonutSegment = {
  label: string
  count: number
  color: string
}

export function SegmentationDonut({
  segments,
  total,
}: {
  segments: DonutSegment[]
  total: number
}) {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const radius = 60
  const cx = 80
  const cy = 80
  const circumference = 2 * Math.PI * radius
  const safeTotal = total > 0 ? total : 1

  // Pre-compute cumulative offsets without mutation (functional style)
  const pcts = segments.map((s) => s.count / safeTotal)
  const cumulativeStarts = pcts.reduce<number[]>((acc, p, i) => {
    const start = i === 0 ? 0 : acc[i - 1] + pcts[i - 1]
    return [...acc, start]
  }, [])
  const arcs = segments.map((s, i) => {
    const pct = pcts[i]
    const dash = pct * circumference
    const offset = -cumulativeStarts[i] * circumference
    return { ...s, idx: i, dash, offset, pct }
  })

  const active = hoverIdx !== null ? arcs[hoverIdx] : null

  return (
    <div className="flex items-center justify-center gap-4 my-2">
      <div className="relative h-40 w-40">
        <svg viewBox="0 0 160 160" className="h-full w-full -rotate-90">
          {/* Background ring */}
          <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#f1f5f9" strokeWidth="16" />
          {arcs.map((a) => (
            <circle
              key={a.idx}
              cx={cx}
              cy={cy}
              r={radius}
              fill="none"
              stroke={a.color}
              strokeWidth={hoverIdx === a.idx ? 20 : 16}
              strokeDasharray={`${a.dash} ${circumference - a.dash}`}
              strokeDashoffset={a.offset}
              className="transition-all duration-300 cursor-pointer"
              onMouseEnter={() => setHoverIdx(a.idx)}
              onMouseLeave={() => setHoverIdx(null)}
              style={{ strokeLinecap: 'butt' }}
            />
          ))}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          {active ? (
            <>
              <div className="text-xl font-extrabold" style={{ color: active.color }}>{formatNum(active.count)}</div>
              <div className="text-[10px] text-muted-foreground">{active.label}</div>
              <div className="text-[10px] font-medium" style={{ color: active.color }}>{(active.pct * 100).toFixed(1)}%</div>
            </>
          ) : (
            <>
              <div className="text-xl font-extrabold">{formatNum(total)}</div>
              <div className="text-[10px] text-muted-foreground">Tổng</div>
            </>
          )}
        </div>
      </div>
      <div className="space-y-1.5 hidden sm:block">
        {arcs.map((a) => (
          <div
            key={a.idx}
            className="flex items-center gap-2 text-xs cursor-pointer rounded-md px-1.5 py-0.5 transition-colors hover:bg-slate-50"
            onMouseEnter={() => setHoverIdx(a.idx)}
            onMouseLeave={() => setHoverIdx(null)}
            style={{ opacity: hoverIdx === null || hoverIdx === a.idx ? 1 : 0.5 }}
          >
            <div className="h-2.5 w-2.5 rounded-sm shrink-0" style={{ background: a.color }} />
            <span className="text-muted-foreground">{a.label}</span>
            <span className="font-bold ml-auto">{(a.pct * 100).toFixed(1)}%</span>
          </div>
        ))}
      </div>
    </div>
  )
}
