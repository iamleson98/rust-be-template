'use client'

/**
 * Revenue bar chart card — "Doanh thu ... gần nhất" (Row 1 of the
 * stats overview): bucketed byDay revenue bars with hover tooltips.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Panel } from '@/components/console/panel'
import { BarChart3 } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { formatVNDShort, formatVNDMillions } from './helpers'
import type { DateRange } from './types'

export function RevenueBarChartCard({
  aggregatedRevenue,
  maxBarValue,
  hoveredBar,
  setHoveredBar,
  totalRangeRevenue,
  dateRange,
}: {
  aggregatedRevenue: { label: string; value: number; date?: string }[]
  maxBarValue: number
  hoveredBar: number | null
  setHoveredBar: React.Dispatch<React.SetStateAction<number | null>>
  totalRangeRevenue: number
  dateRange: DateRange
}) {
  const t = useT()
  return (
    <Panel
      icon={<BarChart3 />}
      title={t('adminDash.revenueLast', {
        range: t(
          dateRange === '7d'
            ? 'adminDash.range7d'
            : dateRange === '30d'
              ? 'adminDash.range30d'
              : 'adminDash.range90d',
        ),
      })}
    >
      {aggregatedRevenue.length > 0 ? (
        <div className="flex items-end gap-1 sm:gap-2 h-48 mt-2">
          {aggregatedRevenue.map((b, i) => {
            const heightPct = (b.value / maxBarValue) * 100
            const isHover = hoveredBar === i
            return (
              <div
                key={i}
                className="flex-1 flex flex-col items-center gap-1.5 min-w-0"
                onMouseEnter={() => setHoveredBar(i)}
                onMouseLeave={() => setHoveredBar(null)}
              >
                {/* Only days with revenue get a figure; empty ones stay a quiet stub. */}
                <div className="h-3.5 truncate text-[10px] font-semibold text-muted-foreground">
                  {b.value > 0 ? `${formatVNDMillions(b.value)}M` : ''}
                </div>
                <div className="w-full relative" style={{ height: '120px' }}>
                  <div
                    className={`group absolute right-0 bottom-0 left-0 cursor-pointer rounded-md transition-colors ${
                      b.value === 0 ? 'bg-slate-100' : isHover ? 'bg-primary/80' : 'bg-primary'
                    }`}
                    style={{ height: b.value > 0 ? `max(${heightPct}%, 4px)` : '4px' }}
                  >
                    <div
                      className={`absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded transition-opacity ${
                        isHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {formatVNDShort(b.value)}
                    </div>
                  </div>
                </div>
                <div className="text-[10px] sm:text-[11px] font-medium text-muted-foreground truncate w-full text-center">
                  {b.label}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
          {t('adminDash.noRevenueData')}
        </div>
      )}
      <div className="flex items-center justify-between mt-3 pt-3 border-t">
        <div className="text-xs text-muted-foreground">{t('adminDash.periodTotal')}</div>
        <div className="text-sm font-bold text-primary">{formatVNDShort(totalRangeRevenue)}</div>
      </div>
    </Panel>
  )
}
