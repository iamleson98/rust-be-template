'use client'

/**
 * Admin route — `/admin/schedules` — schedule management page.
 *
 * Brand → Route filter cascade, then the route's schedules as cards.
 * Each card shows the departure time, days-of-week chips, prices, bus
 * layout, amenities and a vertical timeline of the ordered address
 * points (điểm khởi hành → các điểm trung gian → điểm kết thúc) —
 * the schedule's actual pickup/drop sequence.
 *
 * "Thêm lịch trình" opens the shared ScheduleFormDialog, whose point
 * selects are scoped to the route's brand and offer the map-based
 * address creation modal for addresses that don't exist yet.
 */

import { useMemo, useState } from 'react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  CircleDot,
  Clock,
  Flag,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminBrands,
  useAdminBusLayouts,
  useAdminRoutes,
  useAdminSchedules,
  useDeleteAdminSchedule,
} from '@/lib/queries'
import type {
  AdminBrandOut,
  AdminBusLayoutOut,
  AdminRouteOut,
  AdminScheduleOut,
} from '@/lib/api/types.gen'
import { cn } from '@/lib/utils'
import { ScheduleFormDialog } from '@/components/admin/schedules/schedule-form'
import { formatVND } from '@/lib/types'
import { DAY_LABELS } from '@/components/admin/types'
import { VEHICLE_TYPE_LABELS as VEHICLE_LABELS } from '@/lib/types'
import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'

const CITY_NAME_BY_ID = new Map<string, string>(VIETNAMESE_CITIES.map((c) => [c.id, c.name]))
const cityLabel = (slug: string | null | undefined) =>
  slug ? CITY_NAME_BY_ID.get(slug) ?? slug : '—'

// ── Points timeline ────────────────────────────────────────────────────

const KIND_STYLE = {
  pickup: { dot: 'bg-blue-600 border-blue-200', line: 'bg-blue-200', icon: CircleDot, iconClass: 'text-blue-600' },
  middle: { dot: 'bg-amber-500 border-amber-200', line: 'bg-amber-200', icon: MapPin, iconClass: 'text-amber-600' },
  drop: { dot: 'bg-rose-600 border-rose-200', line: 'bg-rose-200', icon: Flag, iconClass: 'text-rose-600' },
} as const

const KIND_LABEL = { pickup: 'Khởi hành', middle: 'Trung gian', drop: 'Kết thúc' } as const

function PointsTimeline({ points }: { points: AdminScheduleOut['points'] }) {
  if (!points || points.length === 0) {
    return (
      <p className="text-xs text-muted-foreground italic">
        Chưa cấu hình điểm đón — trả cho lịch trình này.
      </p>
    )
  }
  return (
    <ol className="relative space-y-0">
      {points.map((p, i) => {
        const style = KIND_STYLE[(p.kind as keyof typeof KIND_STYLE) ?? 'middle'] ?? KIND_STYLE.middle
        const isLast = i === points.length - 1
        return (
          <li key={p.id} className="relative flex items-start gap-3 pb-3 last:pb-0">
            {/* Vertical connector */}
            {!isLast && (
              <span
                aria-hidden
                className={cn('absolute left-[9px] top-5 bottom-0 w-0.5', style.line)}
              />
            )}
            <span
              className={cn(
                'relative z-10 mt-0.5 h-[19px] w-[19px] shrink-0 rounded-full border-[3px] flex items-center justify-center',
                style.dot,
              )}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white/90" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-medium truncate leading-5">
                <span className="truncate">{p.address.name}</span>
                {p.arrivalTime ? (
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-normal tabular-nums text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                    title="Giờ xe dự kiến tới"
                  >
                    <Clock className="h-2.5 w-2.5" />
                    {p.arrivalTime}
                  </span>
                ) : null}
              </p>
              <p className="text-[11px] text-muted-foreground truncate">
                {KIND_LABEL[(p.kind as keyof typeof KIND_LABEL) ?? 'middle']}
                {p.address.province ? ` · ${p.address.province}` : ''}
                {p.address.district ? ` · ${p.address.district}` : ''}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

// ── Day-of-week chips ──────────────────────────────────────────────────

function DaysChips({ daysOfWeek }: { daysOfWeek?: string | null }) {
  const mask = daysOfWeek ?? '1111111'
  const allOn = mask === '1111111'
  return (
    <span className="flex flex-wrap gap-0.5">
      {DAY_LABELS.map((label, i) => (
        <span
          key={i}
          className={cn(
            'px-1.5 py-0.5 rounded text-[10px] font-medium tabular-nums',
            mask[i] === '1'
              ? 'bg-blue-100 text-blue-700'
              : 'bg-slate-100 text-slate-400',
          )}
        >
          {label}
        </span>
      ))}
      {allOn ? (
        <span className="ml-1 text-[10px] text-muted-foreground self-center">hàng ngày</span>
      ) : null}
    </span>
  )
}

// ── Page ───────────────────────────────────────────────────────────────

function BrandDot({ color }: { color?: string | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  )
}

export function AdminSchedulesPage() {
  const [brandId, setBrandId] = useState<string | undefined>(undefined)
  const [routeId, setRouteId] = useState<string | undefined>(undefined)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editSchedule, setEditSchedule] = useState<AdminScheduleOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminScheduleOut | null>(null)
  const [deleting, setDeleting] = useState(false)

  const brandsQuery = useAdminBrands()
  const brands: AdminBrandOut[] = (brandsQuery.data?.items ?? []) as unknown as AdminBrandOut[]
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId],
  )

  const routesQuery = useAdminRoutes({ brandId })
  const routes: AdminRouteOut[] = (routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]
  const selectedRoute = useMemo(
    () => routes.find((r) => r.id === routeId) ?? null,
    [routes, routeId],
  )

  const schedulesQuery = useAdminSchedules(selectedRoute?.id)
  const schedules: AdminScheduleOut[] =
    (schedulesQuery.data?.items ?? []) as unknown as AdminScheduleOut[]

  const busLayoutsQuery = useAdminBusLayouts({
    brandId: selectedRoute?.brandId ?? undefined,
  })
  const busLayouts: AdminBusLayoutOut[] =
    (busLayoutsQuery.data?.items ?? []) as unknown as AdminBusLayoutOut[]

  const layoutById = useMemo(
    () => new Map(busLayouts.map((l) => [l.id, l])),
    [busLayouts],
  )

  const deleteMutation = useDeleteAdminSchedule()

  const onBrandChange = (v: string) => {
    setBrandId(v === 'all' ? undefined : v)
    setRouteId(undefined)
  }

  const openCreate = () => {
    if (!selectedRoute) {
      toast.error('Chọn tuyến đường trước khi thêm lịch trình')
      return
    }
    setEditSchedule(null)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } })
      toast.success('Đã xoá lịch trình')
      setDeleteTarget(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể xoá lịch trình')
    } finally {
      setDeleting(false)
    }
  }

  const amenitiesOf = (s: AdminScheduleOut) =>
    (s.amenities ?? '').split(',').filter(Boolean)

  return (
    <div className="page-transition p-3 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <CalendarDays className="h-5 w-5 text-blue-600" />
              Lịch trình
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Chuyến xe theo tuyến — giờ chạy, điểm đón/trả theo trình tự, giá và loại xe.
            </p>
          </div>
          <Button size="sm" onClick={openCreate} disabled={!selectedRoute}>
            <Plus className="h-4 w-4 mr-1.5" /> Thêm lịch trình
          </Button>
        </div>

        {/* Filters: brand → route cascade */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="w-full sm:w-56">
            <Select value={brandId ?? 'all'} onValueChange={onBrandChange}>
              <SelectTrigger className="w-full">
                <span className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Tất cả hãng">
                    {(v: string | null | undefined) =>
                      v === 'all' || !v ? 'Tất cả hãng' : selectedBrand?.name ?? 'Hãng'}
                  </SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tất cả hãng</SelectItem>
                {brands.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    <span className="flex items-center gap-2">
                      <BrandDot color={b.accentColor} />
                      {b.name}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-full sm:flex-1">
            <Select
              value={routeId ?? 'none'}
              onValueChange={(v) => setRouteId(v === 'none' ? undefined : v)}
              disabled={!brandId}
            >
              <SelectTrigger className="w-full">
                <span className="flex items-center gap-2 min-w-0">
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder={brandId ? 'Chọn tuyến…' : 'Chọn hãng trước'}>
                    {(v: string | null | undefined) =>
                      v === 'none' || !v
                        ? brandId
                          ? 'Chọn tuyến…'
                          : 'Chọn hãng trước'
                        : selectedRoute?.name ?? 'Tuyến'}
                  </SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent>
                {routes.length === 0 ? (
                  <div className="p-2 text-xs text-center text-muted-foreground">
                    Hãng chưa có tuyến nào
                  </div>
                ) : (
                  routes.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="truncate">{r.name}</span>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {cityLabel(r.startLocationId)} → {cityLabel(r.endLocationId)}
                        </span>
                      </span>
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Schedule cards */}
        {!selectedRoute ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-2">
              <div className="h-11 w-11 rounded-full bg-blue-50 flex items-center justify-center">
                <CalendarDays className="h-5 w-5 text-blue-600" />
              </div>
              <p className="font-medium">Chọn hãng và tuyến đường</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Lịch trình hiển thị theo từng tuyến. Chọn hãng, sau đó chọn tuyến để xem
                và quản lý các chuyến xe.
              </p>
            </CardContent>
          </Card>
        ) : schedulesQuery.isLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-40 w-full" />
            <Skeleton className="h-40 w-full" />
          </div>
        ) : schedules.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-2">
              <div className="h-11 w-11 rounded-full bg-blue-50 flex items-center justify-center">
                <Clock className="h-5 w-5 text-blue-600" />
              </div>
              <p className="font-medium">Tuyến chưa có lịch trình nào</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                Thêm lịch trình đầu tiên cho tuyến {selectedRoute.name} — chọn giờ khởi
                hành, các điểm đón/trả và giá vé.
              </p>
              <Button size="sm" className="mt-1" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5" /> Thêm lịch trình
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-3">
            {schedules.map((s) => {
              const layout = layoutById.get(s.busLayoutId ?? '')
              const amenities = amenitiesOf(s)
              return (
                <Card key={s.id} className="overflow-hidden">
                  <CardContent className="p-0">
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px]">
                      {/* Left: identity + meta */}
                      <div className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="flex flex-col items-center shrink-0">
                              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                              <span className="text-xl font-bold tabular-nums leading-tight text-blue-700">
                                {s.departureTime}
                              </span>
                            </div>
                            <div className="min-w-0">
                              <p className="text-sm font-medium truncate">
                                {selectedRoute.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {selectedBrand?.name}
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
                              onClick={() => {
                                setEditSchedule(s)
                                setDialogOpen(true)
                              }}
                              aria-label="Sửa lịch trình"
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                              onClick={() => setDeleteTarget(s)}
                              aria-label="Xoá lịch trình"
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                          <DaysChips daysOfWeek={s.daysOfWeek} />
                          <span className="flex items-center gap-1.5">
                            <span className="text-muted-foreground text-xs">NL:</span>
                            <span className="font-semibold tabular-nums">
                              {formatVND(s.basePriceAdult)}
                            </span>
                          </span>
                          {s.basePriceChild != null && s.basePriceChild > 0 ? (
                            <span className="flex items-center gap-1.5">
                              <span className="text-muted-foreground text-xs">TE:</span>
                              <span className="font-medium tabular-nums">
                                {formatVND(s.basePriceChild)}
                              </span>
                            </span>
                          ) : null}
                          {s.effectiveFrom ? (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              {s.effectiveFrom}
                              {s.effectiveTo ? ` → ${s.effectiveTo}` : ''}
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
                        <PointsTimeline points={(s as any).points} />
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}

      {/* Create / edit schedule (with point selects + map address modal) */}
      <ScheduleFormDialog
        open={dialogOpen}
        schedule={editSchedule}
        route={selectedRoute}
        busLayouts={busLayouts}
        brandId={selectedRoute?.brandId ?? undefined}
        brandName={selectedBrand?.name ?? brands.find((b) => b.id === selectedRoute?.brandId)?.name}
        onOpenChange={(open) => setDialogOpen(open)}
        onSaved={() => setDialogOpen(false)}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!deleting && !open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xoá lịch trình{' '}
              <span className="font-semibold text-foreground">
                {deleteTarget?.departureTime}
              </span>{' '}
              của tuyến <span className="font-semibold text-foreground">{selectedRoute?.name}</span>?
              Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault()
                confirmDelete()
              }}
              disabled={deleting}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              {deleting ? (
                <>
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> Đang xoá...
                </>
              ) : (
                <>
                  <Trash2 className="h-4 w-4 mr-1.5" /> Xoá
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
