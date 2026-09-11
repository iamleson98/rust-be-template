'use client'

/**
 * Revenue bar chart card — "Doanh thu ... gần nhất" (Row 1 of the
 * stats overview): bucketed byDay revenue bars with hover tooltips.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { BarChart3 } from 'lucide-react'
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
  return (
          <Card className="overflow-hidden">
            <div className="h-1 bg-linear-to-r from-blue-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-blue-600" />
                Doanh thu {dateRange === '7d' ? '7 ngày' : dateRange === '30d' ? '30 ngày' : '90 ngày'} gần nhất
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
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
                        <div className="text-[9px] sm:text-[10px] font-semibold text-muted-foreground truncate">
                          {formatVNDMillions(b.value)}M
                        </div>
                        <div className="w-full relative" style={{ height: '120px' }}>
                          <div
                            className={`absolute bottom-0 left-0 right-0 rounded-t-md bg-linear-to-t cursor-pointer group transition-all ${isHover
                              ? 'from-blue-500 to-blue-300 scale-[1.03]'
                              : 'from-blue-600 to-blue-400 hover:from-blue-500 hover:to-blue-300'
                              }`}
                            style={{ height: `${heightPct}%` }}
                          >
                            <div
                              className={`absolute -top-8 left-1/2 -translate-x-1/2 whitespace-nowrap bg-slate-800 text-white text-[10px] px-1.5 py-0.5 rounded transition-opacity ${isHover ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                                }`}
                            >
                              {formatVNDShort(b.value)}
                            </div>
                          </div>
                        </div>
                        <div className="text-[9px] sm:text-[11px] font-medium text-muted-foreground truncate w-full text-center">
                          {b.label}
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu doanh thu trong kỳ đã chọn
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t">
                <div className="text-xs text-muted-foreground">Tổng kỳ</div>
                <div className="text-sm font-bold text-blue-700">{formatVNDShort(totalRangeRevenue)}</div>
              </div>
            </CardContent>
          </Card>
  )
}
