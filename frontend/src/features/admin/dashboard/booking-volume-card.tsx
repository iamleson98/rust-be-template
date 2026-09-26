'use client'

/**
 * Booking-volume card — "Lượt đặt vé theo ngày" (Row 0 of the stats
 * overview): 24h booking-trends sparkline + totals, driven by real
 * byDay counts.
 *
 * Extracted from the original 'src/features/admin/dashboard/stats-overview.tsx'.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Activity } from 'lucide-react'
import { useT } from '@/lib/i18n'
import { BookingTrendsSparkline } from './charts'
import type { DateRange } from './types'

export function BookingVolumeCard({
  bookingVolumeSeries,
  peakIdx,
  dateRange,
}: {
  bookingVolumeSeries: number[]
  peakIdx: number
  dateRange: DateRange
}) {
  const t = useT()
  return (
          <Card className="overflow-hidden h-full">
            <div className="h-1 bg-linear-to-r from-amber-500 to-orange-500" />
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Activity className="h-4 w-4 text-amber-600" />
                {t('adminDash.bookingsByDay')}
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {bookingVolumeSeries.length > 0 ? (
                <BookingTrendsSparkline values={bookingVolumeSeries} peakIdx={peakIdx >= 0 ? peakIdx : 0} />
              ) : (
                <div className="h-20 flex items-center justify-center text-xs text-muted-foreground">
                  {t('adminDash.noBookingVolumeData')}
                </div>
              )}
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                <div className="rounded-lg bg-amber-50 p-2">
                  <div className="text-base font-bold text-amber-700">
                    {bookingVolumeSeries.reduce((a, b) => a + b, 0)}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{t('adminDash.totalRange', { range: t(dateRange === '7d' ? 'adminDash.range7d' : dateRange === '30d' ? 'adminDash.range30d' : 'adminDash.range90d') })}</div>
                </div>
                <div className="rounded-lg bg-rose-50 p-2">
                  <div className="text-base font-bold text-rose-700">
                    {peakIdx >= 0 ? bookingVolumeSeries[peakIdx] : 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{t('adminDash.peak')}</div>
                </div>
                <div className="rounded-lg bg-slate-50 p-2">
                  <div className="text-base font-bold">
                    {bookingVolumeSeries.length > 0
                      ? Math.round(bookingVolumeSeries.reduce((a, b) => a + b, 0) / bookingVolumeSeries.length)
                      : 0}
                  </div>
                  <div className="text-[10px] text-muted-foreground">{t('adminDash.avgPerDay')}</div>
                </div>
              </div>
            </CardContent>
          </Card>
  )
}
