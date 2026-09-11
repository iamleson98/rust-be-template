'use client'

/**
 * Booking-status donut card — "Phân bổ trạng thái vé" (Row 1 of the
 * stats overview): inline SVG donut + legend, driven by real totals.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart } from 'lucide-react'
import { formatNum } from '@/lib/types'
import type { DonutSegment } from './segmentation-donut'

export function BookingStatusDonutCard({
  statusSegments,
  statusSegmentTotal,
}: {
  statusSegments: DonutSegment[]
  statusSegmentTotal: number
}) {
  return (
          <Card className="overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="h-4 w-4 text-amber-600" />
                Phân bổ trạng thái vé
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {statusSegments.length > 0 ? (
                <>
                  <div className="flex items-center justify-center my-4">
                    <div className="relative h-36 w-36">
                      <svg viewBox="0 0 36 36" className="h-full w-full -rotate-90">
                        {(() => {
                          let cumulative = 0
                          return statusSegments.map((s, i) => {
                            const pct = statusSegmentTotal > 0 ? (s.count / statusSegmentTotal) * 100 : 0
                            const dashArray = `${pct} ${100 - pct}`
                            const offset = -cumulative
                            cumulative += pct
                            return (
                              <circle
                                key={i}
                                cx="18"
                                cy="18"
                                r="14"
                                fill="none"
                                stroke={s.color}
                                strokeWidth="4"
                                strokeDasharray={dashArray}
                                strokeDashoffset={offset}
                                className="transition-all duration-500 hover:stroke-width-[5]"
                                style={{ strokeLinecap: 'butt' }}
                              />
                            )
                          })
                        })()}
                      </svg>
                      <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-2xl font-extrabold">{formatNum(statusSegmentTotal)}</div>
                        <div className="text-[10px] text-muted-foreground">Tổng vé</div>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {statusSegments.map((s, i) => (
                      <div key={i} className="flex items-center gap-2 text-xs">
                        <div className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                        <span className="text-muted-foreground truncate">{s.label}</span>
                        <span className="font-bold ml-auto">{s.count}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu trạng thái vé
                </div>
              )}
            </CardContent>
          </Card>
  )
}
