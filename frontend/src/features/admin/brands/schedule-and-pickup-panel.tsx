'use client'

/**
 * Schedules + pickup points detail panel of the AdminBrandManagement
 * master-detail layout.
 *
 * Extracted from the original 'src/features/admin/brands/panels.tsx'.
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScheduleMiniSkeleton } from '@/features/admin/brands/schedule-mini-skeleton'
import { PickupPointsSkeleton } from '@/features/admin/pickup-points/pickup-points-skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Clock,
  MapPin,
  Bus,
  Plus,
  Pencil,
  Trash2,
  ArrowLeft,
  CalendarDays,
} from 'lucide-react'
import { formatVND } from '@/lib/types'
import type { AdminRouteOut, AdminScheduleOut, AdminPickupPointOut } from '@/lib/api/types.gen'
import { AMENITY_OPTIONS, PICKUP_TYPE_LABELS } from '@/features/admin/types'
import { daysLabel } from './helpers'

export function ScheduleAndPickupPanel({
  selectedRoute,
  schedulesLoading,
  schedules,
  pickupLoading,
  pickupPoints,
  onBack,
  onAddSchedule,
  onEditSchedule,
  onDeleteSchedule,
  onAddPickup,
  onEditPickup,
  onDeletePickup,
  mobileView,
}: {
  selectedRoute: AdminRouteOut | null
  schedulesLoading: boolean
  schedules: AdminScheduleOut[]
  pickupLoading: boolean
  pickupPoints: AdminPickupPointOut[]
  onBack: () => void
  onAddSchedule: () => void
  onEditSchedule: (s: AdminScheduleOut) => void
  onDeleteSchedule: (s: AdminScheduleOut) => void
  onAddPickup: () => void
  onEditPickup: (p: AdminPickupPointOut) => void
  onDeletePickup: (p: AdminPickupPointOut) => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={` overflow-hidden ${mobileView === 'details' ? 'block' : 'hidden lg:block'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Clock className="h-4 w-4 text-blue-600" /> Lịch trình & Điểm đón/trả
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 lg:hidden"
            onClick={onBack}
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </div>
        {selectedRoute ? (
          <div className="text-[11px] text-muted-foreground truncate">
            {selectedRoute.startLocation?.name} → {selectedRoute.endLocation?.name} ·{' '}
            <code className="font-mono">{selectedRoute.id.slice(0, 8)}</code>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="p-0">
        {!selectedRoute ? (
          <div className="p-10 text-center text-xs text-muted-foreground">
            <Bus className="h-10 w-10 mx-auto mb-2 opacity-40" />
            Chọn một tuyến đường để xem lịch trình và điểm đón/trả
          </div>
        ) : (
          <ScrollArea className="h-140">
            <div className="divide-y">
              {/* Schedules section */}
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" /> Lịch khởi hành
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={onAddSchedule}
                  >
                    <Plus className="h-3.5 w-3.5" /> Thêm lịch
                  </Button>
                </div>

                {schedulesLoading ? (
                  <ScheduleMiniSkeleton count={2} />
                ) : schedules.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground py-6 border border-dashed rounded-md">
                    Chưa có lịch trình
                  </div>
                ) : (
                  <div className="space-y-2">
                    {schedules.map((s) => {
                      const amenityList = s.amenities ? s.amenities.split(',').filter(Boolean) : []
                      return (
                        <div
                          key={s.id}
                          className="rounded-lg border p-2.5 bg-white"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono font-bold text-sm text-blue-700">
                                  {s.departureTime}
                                </span>
                                {s.busLayoutId && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                    <Bus className="h-2.5 w-2.5 mr-0.5" />
                                    {s.busLayoutId.slice(0, 8)}
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                                <span className="flex items-center gap-0.5">
                                  <CalendarDays className="h-3 w-3" />
                                  {daysLabel(s.daysOfWeek ?? '')}
                                </span>
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-0.5">
                                <span>Từ {s.effectiveFrom}</span>
                                <span>→</span>
                                <span>đến {s.effectiveTo}</span>
                              </div>
                              <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                                <span className="font-medium text-blue-700">
                                  NL: {formatVND(s.basePriceAdult)}
                                </span>
                                <span className="text-muted-foreground">
                                  TE: {formatVND(s.basePriceChild ?? 0)}
                                </span>
                              </div>
                              {amenityList.length > 0 && (
                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                  {amenityList.map((a) => {
                                    const opt = AMENITY_OPTIONS.find((o) => o.key === a)
                                    if (!opt) return null
                                    const Icon = opt.icon
                                    return (
                                      <Badge key={a} variant="outline" className="text-[9px] h-4 px-1 gap-0.5">
                                        <Icon className="h-2.5 w-2.5" />
                                        {opt.label}
                                      </Badge>
                                    )
                                  })}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-col gap-1 shrink-0">
                              <button
                                type="button"
                                onClick={() => onEditSchedule(s)}
                                className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                                title="Sửa"
                                aria-label={`Sửa lịch ${s.departureTime}`}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              <button
                                type="button"
                                onClick={() => onDeleteSchedule(s)}
                                className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                                title="Xoá"
                                aria-label={`Xoá lịch ${s.departureTime}`}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Pickup points section */}
              <div className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5" /> Điểm đón / trả
                  </h4>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 gap-1"
                    onClick={onAddPickup}
                  >
                    <Plus className="h-3.5 w-3.5" /> Thêm điểm
                  </Button>
                </div>

                {pickupLoading ? (
                  <PickupPointsSkeleton count={2} />
                ) : pickupPoints.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground py-6 border border-dashed rounded-md">
                    Chưa có điểm đón/trả
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {pickupPoints.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border p-2.5 flex items-start gap-2 bg-white"
                      >
                        <div className="flex flex-col items-center shrink-0">
                          <div className="h-6 w-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px] font-bold">
                            {p.stopOrder}
                          </div>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-sm truncate">{p.name}</span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] h-4 px-1 ${p.kind === 'station'
                                ? 'bg-blue-50 text-blue-700'
                                : p.kind === 'curb'
                                  ? 'bg-amber-50 text-amber-700'
                                  : 'bg-slate-100 text-slate-700'
                                }`}
                            >
                              {PICKUP_TYPE_LABELS[p.kind ?? ''] ?? p.kind}
                            </Badge>
                          </div>
                          {p.address && (
                            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {p.address}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-0.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => onEditPickup(p)}
                            className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                            title="Sửa"
                            aria-label={`Sửa điểm đón ${p.name}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => onDeletePickup(p)}
                            className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                            title="Xoá"
                            aria-label={`Xoá điểm đón ${p.name}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  )
}
