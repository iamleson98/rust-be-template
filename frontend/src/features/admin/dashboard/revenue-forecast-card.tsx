'use client'

/**
 * Revenue forecast card — "Dự báo doanh thu 7 ngày tới" (Row 0 of the
 * stats overview): 7-day linear forecast with a widening confidence
 * band, driven by real byDay revenue.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LineChart as LineChartIcon, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import { ForecastChart } from './charts'
import { formatVNDShort } from './helpers'

export function RevenueForecastCard({
  forecast,
}: {
  forecast: {
    forecast: number[]
    lower: number[]
    upper: number[]
    actualSeries: number[]
    actualLabels: string[]
  }
}) {
  return (
          <Card className="overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-blue-500 via-blue-500 to-blue-500" />
            <CardHeader className="pb-2">
              <div className="flex items-start justify-between gap-3">
                <CardTitle className="text-base flex items-center gap-2">
                  <LineChartIcon className="h-4 w-4 text-blue-600" />
                  Dự báo doanh thu 7 ngày tới
                </CardTitle>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-4 rounded-full bg-blue-600" />
                    Thực tế
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-0 w-4 border-t-2 border-dashed border-blue-400" />
                    Dự báo
                  </span>
                </div>
              </div>
            </CardHeader>
            <CardContent className="pt-0">
              {forecast.actualSeries.length > 0 ? (
                <ForecastChart
                  actual={forecast.actualSeries.map((v) => v / 1_000_000)}
                  forecast={forecast.forecast.map((v) => v / 1_000_000)}
                  lower={forecast.lower.map((v) => v / 1_000_000)}
                  upper={forecast.upper.map((v) => v / 1_000_000)}
                  actualLabels={forecast.actualLabels}
                />
              ) : (
                <div className="h-48 flex items-center justify-center text-xs text-muted-foreground">
                  Chưa có dữ liệu doanh thu trong kỳ đã chọn
                </div>
              )}
              <div className="flex items-center justify-between mt-3 pt-3 border-t text-xs">
                <div>
                  <div className="text-muted-foreground">Dự báo tuần tới</div>
                  <div className="text-base font-bold text-blue-700 mt-0.5">
                    {formatVNDShort(forecast.forecast.reduce((a, b) => a + b * 1_000_000, 0))}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-muted-foreground">Xu hướng</div>
                  <div
                    className={`flex items-center gap-1 font-bold mt-0.5 ${(forecast.forecast[forecast.forecast.length - 1] ?? 0) >=
                      (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0)
                      ? 'text-blue-600'
                      : 'text-rose-600'
                      }`}
                  >
                    {(forecast.forecast[forecast.forecast.length - 1] ?? 0) >=
                      (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0) ? (
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    ) : (
                      <ArrowDownRight className="h-3.5 w-3.5" />
                    )}
                    {forecast.actualSeries.length > 0
                      ? Math.abs(
                        ((forecast.forecast[forecast.forecast.length - 1] ?? 0) -
                          (forecast.actualSeries[forecast.actualSeries.length - 1] ?? 0)) /
                        Math.max(1, forecast.actualSeries[forecast.actualSeries.length - 1] ?? 1) *
                        100,
                      ).toFixed(1)
                      : '0.0'}
                    %
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
  )
}
