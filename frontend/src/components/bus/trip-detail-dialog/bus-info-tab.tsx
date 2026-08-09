'use client'

/**
 * BusInfoTab — "Thông tin xe" tab inside the TripDetailDialog.
 *
 * Renders a deterministic mock of the bus (plate number, year, fuel,
 * AC, mileage) and a top-view seat-grid diagram based on the bus
 * layout's vehicleType. The mock is seeded by trip id so the same
 * trip always renders the same bus info.
 *
 * Extracted verbatim from the original `trip-detail-dialog.tsx`
 * (lines 667-927). Pure refactor.
 */

import { useMemo } from 'react'
import { Button } from '@/components/ui/button'
import {
  Bus,
  IdCard,
  CalendarDays,
  Snowflake,
  Fuel,
  Gauge,
  Cog,
  Wrench,
  X,
  CheckCircle2,
  Armchair,
  PhoneCall,
} from 'lucide-react'
import type { TripDetail } from './types'
import { amenityIcon } from './amenity-icons'

/* ─── Seat shape for the diagram (helper) ─── */

function SeatShape({ isSleeper, isLimousine }: { isSleeper: boolean; isLimousine: boolean }) {
  if (isSleeper) {
    return (
      <div
        className="rounded-md border border-blue-500 bg-blue-500/20"
        style={{ width: 36, height: 22 }}
        title="Giường nằm"
      />
    )
  }
  if (isLimousine) {
    return (
      <div
        className="rounded-lg border border-amber-500 bg-violet-500/20"
        style={{ width: 28, height: 24 }}
        title="Ghế limousine"
      />
    )
  }
  return (
    <div
      className="rounded-sm border border-blue-500 bg-blue-500/20"
      style={{ width: 22, height: 22 }}
      title="Ghế ngồi"
    />
  )
}

export function BusInfoTab({ detail }: { detail: TripDetail }) {
  // Deterministic mock data based on trip id
  const seed = useMemo(() => {
    let h = 0
    for (let i = 0; i < detail.trip.id.length; i++) {
      h = (detail.trip.id.charCodeAt(i) + ((h << 5) - h)) | 0
    }
    return Math.abs(h)
  }, [detail.trip.id])

  const plateNumber = useMemo(() => {
    const regions = ['51A', '29A', '30A', '51B', '47A', '60C', '77A', '59A']
    const region = regions[seed % regions.length]
    const num = 10000 + (seed % 89999)
    return `${region}-${num}`
  }, [seed])

  const vehicleYear = 2018 + (seed % 7) // 2018-2024
  const hasToilet = seed % 3 === 0
  const acType = seed % 2 === 0 ? 'Điều hòa trung tâm' : 'Điều hòa cassette'
  const fuelType = seed % 3 === 0 ? 'Diesel' : seed % 3 === 1 ? 'CNG' : 'Điện hybrid'
  const maxSpeed = 80 + (seed % 21) // 80-100 km/h
  const mileage = (50000 + (seed % 200000)).toLocaleString('vi-VN')

  // Bus : derive a simple grid based on vehicle type
  const layoutRows = detail.busLayout.vehicleType === 'sleeper' ? 6 : detail.busLayout.vehicleType === 'limousine' ? 5 : 11
  const layoutCols = detail.busLayout.vehicleType === 'sleeper' ? 3 : detail.busLayout.vehicleType === 'limousine' ? 3 : 4
  const isSleeper = detail.busLayout.vehicleType === 'sleeper'
  const isLimousine = detail.busLayout.vehicleType === 'limousine'

  const driverName = detail.trip.driverName ?? 'Tài xế chuyên nghiệp'

  // Amenities with descriptions
  const amenityDescriptions: Record<string, string> = {
    wifi: 'Wi-Fi miễn phí tốc độ cao trên suốt hành trình',
    ac: 'Hệ thống điều hòa mát mẻ, có thể điều chỉnh riêng',
    water: 'Nước suối miễn phí 1 chai/khách',
    charging: 'Cổng sạc USB/Type-C tại mỗi ghế',
    window: 'Cửa sổ kính mờ, rèm che chống nắng',
    legroom: 'Khoảng để chân rộng rãi thoải mái',
    recline: 'Ghế ngả sâu 135° - 160°',
    curtain: 'Rèm che riêng tư từng ghế',
  }

  const specs = [
    { icon: <CalendarDays className="h-4 w-4" />, label: 'Năm sản xuất', value: String(vehicleYear) },
    { icon: <Snowflake className="h-4 w-4" />, label: 'Loại điều hòa', value: acType },
    { icon: <Fuel className="h-4 w-4" />, label: 'Nhiên liệu', value: fuelType },
    { icon: <Gauge className="h-4 w-4" />, label: 'Tốc độ tối đa', value: `${maxSpeed} km/h` },
    { icon: <Cog className="h-4 w-4" />, label: 'Số ghế', value: String(detail.busLayout.capacity) },
    { icon: <Wrench className="h-4 w-4" />, label: 'Hành trình đã đi', value: `${mileage} km` },
  ]

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Bus className="h-4 w-4 text-blue-700" />
          Thông tin xe & tài xế
        </h3>
        <div className="rounded-xl border bg-white overflow-hidden">
          <div className="grid grid-cols-1 sm:grid-cols-2 divide-y sm:divide-y-0 sm:divide-x">
            {/* Driver info */}
            <div className="p-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-linear-to-br from-blue-100 to-blue-100 text-blue-800 inline-flex items-center justify-center shrink-0">
                <IdCard className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Tài xế</div>
                <div className="font-bold truncate">{driverName}</div>
                <div className="text-xs text-muted-foreground">Kinh nghiệm 5+ năm</div>
              </div>
            </div>
            {/* Plate number */}
            <div className="p-4 flex items-center gap-3">
              <div className="h-12 w-12 rounded-full bg-linear-to-br from-amber-100 to-orange-100 text-amber-700 inline-flex items-center justify-center shrink-0">
                <Bus className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Biển số xe</div>
                <div className="font-bold font-mono text-base tracking-wider">{plateNumber}</div>
                <div className="text-xs text-muted-foreground">{detail.brand.name}</div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Vehicle specs */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Gauge className="h-4 w-4 text-blue-700" />
          Thông số kỹ thuật
        </h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {specs.map((s, i) => (
            <div key={i} className="rounded-lg border bg-white p-3">
              <div className="text-blue-700 mb-1.5">{s.icon}</div>
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{s.label}</div>
              <div className="font-bold text-sm">{s.value}</div>
            </div>
          ))}
          <div className="rounded-lg border bg-white p-3">
            <div className="text-blue-700 mb-1.5">
              {hasToilet ? <Wrench className="h-4 w-4" /> : <X className="h-4 w-4" />}
            </div>
            <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">Nhà vệ sinh</div>
            <div className="font-bold text-sm">{hasToilet ? 'Có ở cuối xe' : 'Không'}</div>
          </div>
        </div>
      </div>

      {/* Bus diagram (top view) */}
      <div>
        <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
          <Armchair className="h-4 w-4 text-blue-700" />
          Sơ đồ mặt bằng xe (top view)
        </h3>
        <div className="rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 p-4 overflow-x-auto">
          <div className="min-w-70 mx-auto" style={{ maxWidth: 360 }}>
            {/* Driver row */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b-2 border-dashed border-slate-300">
              <div className="flex items-center gap-2">
                <div className="h-10 w-10 rounded-full bg-slate-700 text-white inline-flex items-center justify-center" title="Ghế tài xế">
                  <IdCard className="h-5 w-5" />
                </div>
                <div className="text-[10px] text-muted-foreground uppercase font-semibold">Tài xế</div>
              </div>
              <div className="text-[10px] text-muted-foreground">Mặt trước ↑</div>
            </div>

            {/* Seat grid */}
            <div className="space-y-1.5">
              {Array.from({ length: layoutRows }).map((_, r) => (
                <div key={r} className="flex items-center justify-between gap-1.5">
                  <div className="flex gap-1.5">
                    {/* Left side seats */}
                    <SeatShape isSleeper={isSleeper} isLimousine={isLimousine} />
                    {layoutCols >= 3 && <SeatShape isSleeper={isSleeper} isLimousine={isLimousine} />}
                  </div>
                  {/* Aisle */}
                  <div className="w-3 text-center text-[8px] text-slate-300">·</div>
                  <div className="flex gap-1.5">
                    {/* Right side seats */}
                    {layoutCols >= 3 && <SeatShape isSleeper={isSleeper} isLimousine={isLimousine} />}
                    {layoutCols >= 4 && <SeatShape isSleeper={isSleeper} isLimousine={isLimousine} />}
                  </div>
                </div>
              ))}
            </div>

            {/* Back row */}
            <div className="mt-3 pt-2 border-t-2 border-dashed border-slate-300 flex items-center justify-between">
              <div className="text-[10px] text-muted-foreground">Mặt sau ↓</div>
              {hasToilet && (
                <div className="flex items-center gap-1 text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full">
                  <Wrench className="h-3 w-3" /> Toilet
                </div>
              )}
            </div>
          </div>

          {/* Legend */}
          <div className="mt-4 flex items-center justify-center gap-4 text-[10px] text-muted-foreground flex-wrap">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-blue-500/30 border border-blue-500" />
              Ghế thường
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-violet-500/30 border border-amber-500" />
              Ghế VIP
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-slate-200 border border-slate-300" />
              Đã đặt
            </div>
          </div>
        </div>
      </div>

      {/* Amenities list */}
      {detail.amenities.length > 0 && (
        <div>
          <h3 className="text-sm font-bold flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-blue-700" />
            Tiện nghi trên xe
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {detail.amenities.map((a) => (
              <div
                key={a.key}
                className="flex items-start gap-2.5 rounded-lg border bg-white p-3"
              >
                <div className="h-8 w-8 rounded-lg bg-blue-50 text-blue-800 inline-flex items-center justify-center shrink-0">
                  {amenityIcon[a.key] ?? <CheckCircle2 className="h-4 w-4" />}
                </div>
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{a.label}</div>
                  <div className="text-xs text-muted-foreground">
                    {amenityDescriptions[a.key] ?? 'Tiện nghi có sẵn trên xe'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Brand contact */}
      {detail.brand.contactPhone && (
        <div className="rounded-xl bg-linear-to-r from-blue-50 to-blue-50 ring-1 ring-blue-200/50 p-4 flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-blue-700 text-white inline-flex items-center justify-center shrink-0">
            <PhoneCall className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs text-muted-foreground">Hotline nhà xe</div>
            <div className="font-bold text-blue-800">{detail.brand.contactPhone}</div>
          </div>
          <Button
            size="sm"
            variant="outline"
            className="border-blue-300 text-blue-800 hover:bg-blue-50"
            asChild
          >
            <a href={`tel:${detail.brand.contactPhone}`}>Gọi ngay</a>
          </Button>
        </div>
      )}
    </div>
  )
}
