'use client'

/**
 * Booking segmentation card — "Phân loại vé theo trạng thái" (Row 2
 * of the stats overview): SegmentationDonut + per-status breakdown,
 * driven by real totals.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PieChart } from 'lucide-react'
import { formatNum } from '@/lib/types'
import { SegmentationDonut, type DonutSegment } from './segmentation-donut'

export function BookingSegmentationCard({
  statusSegments,
  statusSegmentTotal,
}: {
  statusSegments: DonutSegment[]
  statusSegmentTotal: number
}) {
  return (
          <Card className="overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-violet-500 via-amber-500 to-blue-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <PieChart className="h-4 w-4 text-violet-600" />
                Phân loại vé theo trạng thái
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {statusSegments.length > 0 ? (
                <>
                  <SegmentationDonut segments={statusSegments} total={statusSegmentTotal} />
                  <div className="grid grid-cols-2 gap-2 mt-4">
                    {statusSegments.map((s) => {
                      const pct = statusSegmentTotal > 0 ? ((s.count / statusSegmentTotal) * 100).toFixed(1) : '0.0'
                      return (
                        <div key={s.label} className="rounded-lg border p-2.5">
                          <div className="flex items-center justify-between">
                            <div className="text-xs font-semibold truncate">{s.label}</div>
                            <div className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                          </div>
                          <div className="flex items-end justify-between mt-1">
                            <div className="text-base font-bold">{formatNum(s.count)}</div>
                            <div className="text-[11px] font-medium" style={{ color: s.color }}>{pct}%</div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </>
              ) : (
                <div className="h-40 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu phân loại vé
                </div>
              )}
            </CardContent>
          </Card>
  )
}
