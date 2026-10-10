import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type TileSize = 'md' | 'sm' | 'xs'

/** Pixel metrics per tile size; berths and cabins are taller (they lie
 *  along the vehicle). */
export const METRICS: Record<TileSize, { w: number; h: number; berthH: number; gap: number }> = {
  md: { w: 44, h: 44, berthH: 64, gap: 6 },
  sm: { w: 32, h: 32, berthH: 46, gap: 4 },
  xs: { w: 14, h: 14, berthH: 22, gap: 2 },
}

export type GridItem = {
  key: string
  row: number
  col: number
  node: ReactNode
  /** The row this sits in grows to berth height. */
  tall?: boolean
}

/**
 * One deck as a uniform CSS grid. Cells are placed by (row, col); every
 * position without an item is an aisle or gap — or, in the editor, an
 * empty slot drawn by `renderEmpty`.
 */
export function DeckGrid({
  rows,
  cols,
  size = 'md',
  berths = false,
  items,
  renderEmpty,
  className,
  ...aria
}: {
  rows: number
  cols: number
  size?: TileSize
  /** The deck holds berths: aisle/empty rows take berth height too. */
  berths?: boolean
  items: GridItem[]
  renderEmpty?: (row: number, col: number) => ReactNode
  className?: string
  role?: string
  'aria-label'?: string
}) {
  const m = METRICS[size]
  const rowState = Array.from({ length: rows }, (_, i) => {
    const inRow = items.filter((it) => it.row === i + 1)
    return { tall: inRow.some((it) => it.tall), empty: inRow.length === 0 }
  })
  const heights = rowState.map((r) => (r.tall || (r.empty && berths) ? m.berthH : m.h))
  const occupied = new Set(items.map((it) => `${it.row}:${it.col}`))

  return (
    <div
      {...aria}
      className={cn('mx-auto grid w-max', className)}
      style={{
        gridTemplateColumns: `repeat(${cols}, ${m.w}px)`,
        gridTemplateRows: heights.map((h) => `${h}px`).join(' '),
        gap: m.gap,
      }}
    >
      {items.map((it) => (
        <div
          key={it.key}
          className="flex items-center justify-center"
          style={{ gridRow: it.row, gridColumn: it.col }}
        >
          {it.node}
        </div>
      ))}
      {renderEmpty &&
        Array.from({ length: rows * cols }, (_, i) => {
          const row = Math.floor(i / cols) + 1
          const col = (i % cols) + 1
          return occupied.has(`${row}:${col}`) ? null : (
            <div
              key={`empty-${row}-${col}`}
              className="flex items-center justify-center"
              style={{ gridRow: row, gridColumn: col }}
            >
              {renderEmpty(row, col)}
            </div>
          )
        })}
    </div>
  )
}

/** The bordered chrome around one deck: optional title strip + a front marker. */
export function DeckFrame({
  title,
  aside,
  children,
}: {
  title?: string
  aside?: string
  children: ReactNode
}) {
  return (
    <div className="overflow-hidden rounded-xl border-2 border-slate-200">
      {title && (
        <div className="flex items-center justify-between bg-slate-100 px-4 py-1.5 text-xs font-bold tracking-wide text-slate-600 uppercase">
          <span>{title}</span>
          {aside && <span className="text-muted-foreground">{aside}</span>}
        </div>
      )}
      <div className="overflow-x-auto bg-linear-to-b from-slate-50 to-white p-3 sm:p-5">
        <div className="mx-auto mb-3 h-1.5 w-24 rounded-full bg-slate-200" aria-hidden />
        {children}
      </div>
    </div>
  )
}
