'use client'

/**
 * Card for one schedule on the admin schedules page — left: departure
 * time, route/brand/layout identity, days-of-week chips, prices and
 * amenities; right: the points timeline.
 *
 * Extracted from the original 'src/routes/admin/schedules.tsx'.
 */

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Clock, MapPin, Pencil, Trash2 } from 'lucide-react'
import type { AdminBusLayoutOut, AdminScheduleOut } from '@/lib/api/types.gen'
import { formatVND } from '@/lib/types'
import { VEHICLE_TYPE_LABELS as VEHICLE_LABELS } from '@/lib/types'
import { DaysChips } from './days-chips'
import { PointsTimeline } from './points-timeline'

const amenitiesOf = (s: AdminScheduleOut) =>
  (s.amenities ?? '').split(',').filter(Boolean)

export function ScheduleCard({
  schedule,
  routeName,
  brandName,
  layout,
  onEdit,
  onDelete,
}: {
  schedule: AdminScheduleOut
  routeName: string
  brandName?: string | null
  layout?: AdminBusLayoutOut
  onEdit: (schedule: AdminScheduleOut) => void
  onDelete: (schedule: AdminScheduleOut) => void
}) {
  const amenities = amenitiesOf(schedule)
  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
          {/* Left: identity + meta */}
          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex flex-col items-center shrink-0">
                  <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-xl font-bold tabular-nums leading-tight text-blue-700">
                    {schedule.departureTime}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {routeName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {brandName}
                    {layout ? ` · ${layout.name}` : ''}
                    {layout ? ` (${VEHICLE_LABELS[layout.vehicleType ?? ''] ?? layout.vehicleType})` : ''}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={() => onEdit(schedule)}
                  aria-label="Sửa lịch trình"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                  onClick={() => onDelete(schedule)}
                  aria-label="Xoá lịch trình"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
              <DaysChips daysOfWeek={schedule.daysOfWeek} />
              <span className="flex items-center gap-1.5">
                <span className="text-muted-foreground text-xs">NL:</span>
                <span className="font-semibold tabular-nums">
                  {formatVND(schedule.basePriceAdult)}
                </span>
              </span>
              {schedule.basePriceChild != null && schedule.basePriceChild > 0 ? (
                <span className="flex items-center gap-1.5">
                  <span className="text-muted-foreground text-xs">TE:</span>
                  <span className="font-medium tabular-nums">
                    {formatVND(schedule.basePriceChild)}
                  </span>
                </span>
              ) : null}
              {schedule.effectiveFrom ? (
                <span className="text-xs text-muted-foreground tabular-nums">
                  {schedule.effectiveFrom}
                  {schedule.effectiveTo ? ` → ${schedule.effectiveTo}` : ''}
                </span>
              ) : null}
            </div>

            {amenities.length > 0 ? (
              <div className="flex flex-wrap gap-1">
                {amenities.slice(0, 6).map((a) => (
                  <Badge key={a} variant="outline" className="text-[10px] font-normal">
                    {a}
                  </Badge>
                ))}
                {amenities.length > 6 ? (
                  <Badge variant="outline" className="text-[10px] font-normal">
                    +{amenities.length - 6}
                  </Badge>
                ) : null}
              </div>
            ) : null}
          </div>

          {/* Right: points timeline */}
          <div className="border-t lg:border-t-0 lg:border-l bg-slate-50/60 p-4">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <MapPin className="h-3 w-3" /> Điểm đón — trả
            </p>
            <PointsTimeline points={(schedule as any).points} />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
