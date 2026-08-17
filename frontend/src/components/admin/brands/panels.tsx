'use client'

/**
 * List panels for the AdminBrandManagement master-detail layout.
 *
 * Extracted verbatim from the original `admin-brand-management.tsx`
 * (lines 494-1000). The three panels (Brands list, Routes list,
 * Schedules+PickupPoints detail) are visually self-contained cards
 * that take their data + handlers as props from the orchestrator
 * `index.tsx`. Pure refactor — same UI, same DOM, same handlers.
 */

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ScrollArea } from '@/components/ui/scroll-area'
import {
  Building2,
  Route as RouteIcon,
  Clock,
  MapPin,
  Bus,
  Plus,
  Pencil,
  Trash2,
  Search,
  ArrowLeft,
  Star,
  CalendarDays,
  ChevronRight,
} from 'lucide-react'
import { formatVND } from '@/lib/types'
import type { AdminBrandRow as Brand, AdminRouteRow as RouteItem, Schedule, PickupPoint } from '@/components/admin/types'
import { AMENITY_OPTIONS, PICKUP_TYPE_LABELS } from '@/components/admin/types'
import { formatDurationShort, daysLabel } from './helpers'

/* ─── Brands list (left panel) ─── */

export function BrandListPanel({
  brandsLoading,
  filteredBrands,
  brandSearch,
  setBrandSearch,
  selectedBrand,
  onSelectBrand,
  onAdd,
  onEdit,
  onDelete,
  mobileView,
}: {
  brandsLoading: boolean
  filteredBrands: Brand[]
  brandSearch: string
  setBrandSearch: (v: string) => void
  selectedBrand: Brand | null
  onSelectBrand: (b: Brand) => void
  onAdd: () => void
  onEdit: (b: Brand) => void
  onDelete: (b: Brand) => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={`shadow-sm overflow-hidden ${mobileView === 'brands' ? 'block' : 'hidden lg:block'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm flex items-center gap-2">
            <Building2 className="h-4 w-4 text-rose-600" /> Hãng xe
          </CardTitle>
          <Button
            size="sm"
            variant="default"
            className="h-7 gap-1"
            onClick={onAdd}
          >
            <Plus className="h-3.5 w-3.5" /> Thêm
          </Button>
        </div>
        <div className="relative mt-2">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Tìm hãng xe..."
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[560px]">
          {brandsLoading ? (
            <div className="p-3 space-y-2">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full" />
              ))}
            </div>
          ) : filteredBrands.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <Building2 className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chưa có hãng xe nào
            </div>
          ) : (
            <div className="divide-y">
              {filteredBrands.map((b) => (
                <div
                  key={b.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectBrand(b)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectBrand(b)
                    }
                  }}
                  className={`w-full text-left p-3 hover:bg-slate-50 transition-colors flex items-start gap-2.5 cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-rose-200 rounded-sm ${
                    selectedBrand?.id === b.id ? 'bg-rose-50/60 border-l-2 border-l-rose-600' : ''
                  }`}
                >
                  <div
                    className="h-9 w-9 rounded-lg flex items-center justify-center text-white text-xs font-bold shrink-0"
                    style={{ background: b.accentColor }}
                  >
                    {b.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="font-medium text-sm truncate">{b.name}</span>
                      {b.status === 'inactive' && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">Ẩn</Badge>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                      <span className="flex items-center gap-0.5 text-amber-500">
                        <Star className="h-3 w-3 fill-current" /> {b.rating.toFixed(1)}
                      </span>
                      <span>{b.routeCount} tuyến</span>
                      <span>{b.layoutCount} xe</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onEdit(b)
                      }}
                      className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                      title="Sửa"
                      aria-label={`Sửa hãng ${b.name}`}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        onDelete(b)
                      }}
                      className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                      title="Xoá"
                      aria-label={`Xoá hãng ${b.name}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

/* ─── Routes list (middle panel) ─── */

export function RouteListPanel({
  routesLoading,
  filteredRoutes,
  routeSearch,
  setRouteSearch,
  selectedBrand,
  selectedRoute,
  onSelectRoute,
  onAdd,
  onEdit,
  onDelete,
  onBack,
  mobileView,
}: {
  routesLoading: boolean
  filteredRoutes: RouteItem[]
  routeSearch: string
  setRouteSearch: (v: string) => void
  selectedBrand: Brand | null
  selectedRoute: RouteItem | null
  onSelectRoute: (r: RouteItem) => void
  onAdd: () => void
  onEdit: (r: RouteItem) => void
  onDelete: (r: RouteItem) => void
  onBack: () => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={`shadow-sm overflow-hidden ${mobileView === 'routes' ? 'block' : 'hidden lg:block'}`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <RouteIcon className="h-4 w-4 text-blue-600" /> Tuyến đường
          </CardTitle>
          <div className="flex items-center gap-1">
            <Button
              size="sm"
              variant="ghost"
              className="h-7 lg:hidden"
              onClick={onBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button
              size="sm"
              className="h-7 gap-1"
              disabled={!selectedBrand}
              onClick={onAdd}
            >
              <Plus className="h-3.5 w-3.5" /> Thêm
            </Button>
          </div>
        </div>
        {selectedBrand ? (
          <div className="text-[11px] text-muted-foreground truncate">
            Thuộc: <span className="font-medium" style={{ color: selectedBrand.accentColor }}>{selectedBrand.name}</span>
          </div>
        ) : null}
        <div className="relative mt-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Tìm tuyến..."
            value={routeSearch}
            onChange={(e) => setRouteSearch(e.target.value)}
            className="h-8 pl-8 text-xs"
            disabled={!selectedBrand}
          />
        </div>
      </CardHeader>
      <CardContent className="p-0">
        <ScrollArea className="h-[540px]">
          {!selectedBrand ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <RouteIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chọn một hãng xe bên trái
            </div>
          ) : routesLoading ? (
            <div className="p-3 space-y-2">
              {[...Array(4)].map((_, i) => (
                <Skeleton key={i} className="h-20 w-full" />
              ))}
            </div>
          ) : filteredRoutes.length === 0 ? (
            <div className="p-8 text-center text-xs text-muted-foreground">
              <RouteIcon className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Chưa có tuyến nào
            </div>
          ) : (
            <div className="divide-y">
              {filteredRoutes.map((r) => (
                <div
                  key={r.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectRoute(r)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      onSelectRoute(r)
                    }
                  }}
                  className={`w-full text-left p-3 hover:bg-slate-50 transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-blue-200 rounded-sm ${
                    selectedRoute?.id === r.id ? 'bg-blue-50/60 border-l-2 border-l-blue-600' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <code className="text-[11px] font-mono font-bold text-blue-700">{r.code}</code>
                    <div className="flex items-center gap-1 shrink-0">
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5">
                        {r.scheduleCount} lịch
                      </Badge>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onEdit(r)
                        }}
                        className="text-slate-400 hover:text-blue-600 p-1 rounded transition-colors"
                        title="Sửa"
                        aria-label={`Sửa tuyến ${r.name}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onDelete(r)
                        }}
                        className="text-slate-400 hover:text-rose-600 p-1 rounded transition-colors"
                        title="Xoá"
                        aria-label={`Xoá tuyến ${r.name}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                  <div className="font-medium text-sm mt-0.5 truncate">{r.name}</div>
                  <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {r.startLocation?.name ?? '—'} → {r.endLocation?.name ?? '—'}
                  </div>
                  <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
                    <span>{r.distanceKm} km</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" /> {formatDurationShort(r.durationMin)}
                    </span>
                    <span className="flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {r.pickupPointCount}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </CardContent>
    </Card>
  )
}

/* ─── Schedules + Pickup points detail (right panel) ─── */

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
  selectedRoute: RouteItem | null
  schedulesLoading: boolean
  schedules: Schedule[]
  pickupLoading: boolean
  pickupPoints: PickupPoint[]
  onBack: () => void
  onAddSchedule: () => void
  onEditSchedule: (s: Schedule) => void
  onDeleteSchedule: (s: Schedule) => void
  onAddPickup: () => void
  onEditPickup: (p: PickupPoint) => void
  onDeletePickup: (p: PickupPoint) => void
  mobileView: 'brands' | 'routes' | 'details'
}) {
  return (
    <Card
      className={`shadow-sm overflow-hidden ${mobileView === 'details' ? 'block' : 'hidden lg:block'}`}
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
            <code className="font-mono">{selectedRoute.code}</code>
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
          <ScrollArea className="h-[560px]">
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
                  <div className="space-y-2">
                    {[...Array(2)].map((_, i) => (
                      <Skeleton key={i} className="h-20 w-full" />
                    ))}
                  </div>
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
                          className="rounded-lg border p-2.5 hover:shadow-sm transition-shadow bg-white"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="font-mono font-bold text-sm text-blue-700">
                                  {s.departureTime}
                                </span>
                                {s.busLayout && (
                                  <Badge variant="secondary" className="text-[10px] h-4 px-1">
                                    <Bus className="h-2.5 w-2.5 mr-0.5" />
                                    {s.busLayout.name} ({s.busLayout.capacity})
                                  </Badge>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-muted-foreground mt-1">
                                <span className="flex items-center gap-0.5">
                                  <CalendarDays className="h-3 w-3" />
                                  {daysLabel(s.daysOfWeek)}
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
                                  TE: {formatVND(s.basePriceChild)}
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
                  <div className="space-y-2">
                    {[...Array(2)].map((_, i) => (
                      <Skeleton key={i} className="h-14 w-full" />
                    ))}
                  </div>
                ) : pickupPoints.length === 0 ? (
                  <div className="text-center text-[11px] text-muted-foreground py-6 border border-dashed rounded-md">
                    Chưa có điểm đón/trả
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {pickupPoints.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border p-2.5 flex items-start gap-2 hover:shadow-sm transition-shadow bg-white"
                      >
                        <div className="flex flex-col items-center shrink-0">
                          <div className="h-6 w-6 rounded-full bg-rose-100 text-rose-700 flex items-center justify-center text-[10px] font-bold">
                            {p.stopOrder}
                          </div>
                          {p.etaOffsetMin > 0 && (
                            <div className="text-[9px] text-muted-foreground mt-0.5 whitespace-nowrap">
                              +{p.etaOffsetMin}p
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-medium text-sm truncate">{p.name}</span>
                            <Badge
                              variant="outline"
                              className={`text-[9px] h-4 px-1 ${
                                p.pickupType === 'station'
                                  ? 'bg-blue-50 text-blue-700'
                                  : p.pickupType === 'curb'
                                    ? 'bg-amber-50 text-amber-700'
                                    : 'bg-slate-100 text-slate-700'
                              }`}
                            >
                              {PICKUP_TYPE_LABELS[p.pickupType] ?? p.pickupType}
                            </Badge>
                          </div>
                          {p.address && (
                            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
                              {p.address}
                            </div>
                          )}
                          {p.place && (
                            <div className="text-[10px] text-muted-foreground mt-0.5 truncate">
                              📍 {p.place.name}
                              {p.place.province ? ` · ${p.place.province}` : ''}
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

/* ─── Breadcrumb header ─── */

export function BrandManagementBreadcrumb({
  selectedBrand,
  selectedRoute,
  onBrandsClick,
  onRoutesClick,
}: {
  selectedBrand: Brand | null
  selectedRoute: RouteItem | null
  onBrandsClick: () => void
  onRoutesClick: () => void
}) {
  return (
    <div className="flex items-center gap-2 text-sm flex-wrap">
      <button
        onClick={onBrandsClick}
        className={`font-semibold hover:underline ${!selectedBrand ? 'text-foreground' : 'text-muted-foreground'}`}
      >
        Hãng xe
      </button>
      {selectedBrand && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <button
            onClick={onRoutesClick}
            className={`hover:underline ${!selectedRoute ? 'text-foreground font-semibold' : 'text-muted-foreground'}`}
          >
            {selectedBrand.name}
          </button>
        </>
      )}
      {selectedBrand && selectedRoute && (
        <>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-foreground font-semibold">{selectedRoute.name}</span>
        </>
      )}
    </div>
  )
}
