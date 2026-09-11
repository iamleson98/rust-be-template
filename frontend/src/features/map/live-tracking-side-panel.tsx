'use client'

// Extracted from the original 'live-tracking.tsx'.

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  PhoneCall,
  Star,
  MapPin,
  Clock,
  CircleDot,
  CheckCircle2,
  Flag,
} from 'lucide-react'
import { formatDuration, formatTimeVN } from '@/lib/types'
import { hashString, formatCountdown } from './live-tracking-helpers'
import type { TripDetail, TrackingStatus } from './live-tracking-types'

export function LiveTrackingSidePanel({
  detail,
  nextStop,
  status,
  now,
  stopsWithStatus,
  elapsedMin,
}: {
  detail: TripDetail
  nextStop: TripDetail['pickupPoints'][number] | null
  status: TrackingStatus
  now: number
  stopsWithStatus: (TripDetail['pickupPoints'][number] & { status: 'passed' | 'current' | 'upcoming' })[]
  elapsedMin: number
}) {
  // Mock driver + vehicle data derived from trip id (deterministic)
  const seed = useMemo(() => hashString(detail.trip.id), [detail.trip.id])
  const driverName =
    detail.trip.driverName ??
    ['Nguyễn Văn Minh', 'Trần Quốc Bảo', 'Lê Hoàng Nam', 'Phạm Đức Anh'][seed % 4]
  const driverPhone = `09${String(10000000 + (seed % 89999999)).padStart(8, '0')}`
  const driverRating = (4.5 + (seed % 5) * 0.1).toFixed(1)
  const plateNumber = useMemo(() => {
    const regions = ['51A', '29A', '30A', '51B', '47A', '60C', '77A', '59A']
    const region = regions[seed % regions.length]
    const num = 10000 + (seed % 89999)
    return `${region}-${num}`
  }, [seed])

  return (
    <div className="space-y-3">
      {/* Driver info */}
      <div className="rounded-xl border bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Thông tin tài xế
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-10 w-10 rounded-full bg-linear-to-br from-blue-100 to-blue-100 text-blue-700 inline-flex items-center justify-center font-bold shrink-0">
            {driverName.split(' ').slice(-1)[0]?.[0] ?? '?'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm truncate">{driverName}</div>
            <div className="flex items-center gap-1 text-xs text-amber-600">
              <Star className="h-3 w-3 fill-current" />
              {driverRating}
              <span className="text-muted-foreground ml-1">• 5+ năm KN</span>
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-2.5 gap-1.5 text-xs h-8"
          asChild
        >
          <a href={`tel:${driverPhone}`}>
            <PhoneCall className="h-3.5 w-3.5" /> {driverPhone}
          </a>
        </Button>
      </div>

      {/* Bus info */}
      <div className="rounded-xl border bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Thông tin xe
        </div>
        <div className="space-y-1.5 text-xs">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Biển số</span>
            <span className="font-mono font-bold">{plateNumber}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Loại xe</span>
            <span className="font-medium">{detail.busLayout.vehicleTypeLabel}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Số chỗ</span>
            <span className="font-medium">{detail.busLayout.capacity} chỗ</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Đội xe</span>
            <span className="font-medium truncate ml-2">{detail.brand.name}</span>
          </div>
        </div>
      </div>

      {/* Next stop highlight */}
      {nextStop ? (
        <div
          key={nextStop.id}
          className="rounded-xl bg-linear-to-br from-blue-50 to-blue-50 ring-1 ring-blue-200 p-3"
        >
          <div className="text-[10px] uppercase tracking-wide text-blue-600 font-semibold mb-1">
            Trạm dừng tiếp theo
          </div>
          <div className="font-bold text-sm text-blue-800 truncate flex items-center gap-1">
            <Flag className="h-3.5 w-3.5 shrink-0" />
            {nextStop.name}
          </div>
          <div className="text-xs text-blue-600 mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            <span>
              Đến sau{' '}
              {(() => {
                const depTs = new Date(detail.trip.departureAt).getTime()
                const stopTs = depTs + nextStop.etaOffsetMin * 60_000
                const secToStop = Math.max(0, Math.floor((stopTs - now) / 1000))
                return formatCountdown(secToStop)
              })()}
            </span>
          </div>
        </div>
      ) : (
        <div className="rounded-xl bg-slate-50 ring-1 ring-slate-200 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-1">
            {status === 'arrived' ? 'Trạm đến' : 'Trạm xuất phát'}
          </div>
          <div className="font-bold text-sm text-slate-800 truncate flex items-center gap-1">
            <MapPin className="h-3.5 w-3.5 shrink-0" />
            {status === 'arrived' ? detail.to.name : detail.from.name}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {status === 'arrived'
              ? `Đã đến lúc ${formatTimeVN(detail.trip.arrivalAt)}`
              : `Khởi hành lúc ${formatTimeVN(detail.trip.departureAt)}`}
          </div>
        </div>
      )}

      {/* Stop list with statuses */}
      <div className="rounded-xl border bg-white p-3">
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
          Lịch trình các trạm
        </div>
        <div className="space-y-0 max-h-72 overflow-y-auto pr-1 custom-scroll">
          {stopsWithStatus.map((s, i) => {
            const isCurrent = s.status === 'current'
            const isPassed = s.status === 'passed'
            const isLast = i === stopsWithStatus.length - 1
            return (
              <div key={s.id} className="flex items-start gap-2">
                <div className="flex flex-col items-center pt-0.5">
                  {isPassed ? (
                    <CheckCircle2 className="h-3.5 w-3.5 text-blue-500" />
                  ) : isCurrent ? (
                    <CircleDot className="h-3.5 w-3.5 text-blue-600" />
                  ) : (
                    <div className="h-3 w-3 rounded-full border-2 border-slate-300" />
                  )}
                  {!isLast && <div className="w-px h-5 bg-slate-200 mt-0.5" />}
                </div>
                <div className="flex-1 min-w-0 pb-1.5">
                  <div
                    className={`text-xs font-medium truncate ${
                      isPassed
                        ? 'text-slate-500 line-through'
                        : isCurrent
                          ? 'text-blue-700'
                          : 'text-slate-700'
                    }`}
                  >
                    {s.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground">
                    {isPassed
                      ? 'Đã đi qua'
                      : isCurrent
                        ? 'Đang tại đây'
                        : `Còn ${formatDuration(Math.max(0, s.etaOffsetMin - elapsedMin))}`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
