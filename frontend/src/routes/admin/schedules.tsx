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
 *
 * The card, points timeline, day chips and delete dialog live in
 * `src/features/admin/schedules/`; this file is the thin page shell
 * (data wiring + layout).
 */

import { useMemo, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ArrowRight,
  Building2,
  CalendarDays,
  Clock,
  Plus,
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
import { BrandDot } from '@/features/admin/brand-dot'
import { ScheduleCard } from '@/features/admin/schedules/schedule-card'
import { ScheduleDeleteDialog } from '@/features/admin/schedules/schedule-delete-dialog'
import { cityLabel } from '@/features/admin/schedules/schedule-page-helpers'
import { ScheduleFormDialog } from '@/features/admin/schedules/schedule-form'

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
                    v === 'all' || !v ? 'Tất cả hãng' : selectedBrand?.name ?? 'Hãng'
                  }
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
                      : selectedRoute?.name ?? 'Tuyến'
                  }
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
          {schedules.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              routeName={selectedRoute.name}
              brandName={selectedBrand?.name}
              layout={layoutById.get(s.busLayoutId ?? '')}
              onEdit={(schedule) => {
                setEditSchedule(schedule)
                setDialogOpen(true)
              }}
              onDelete={setDeleteTarget}
            />
          ))}
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
      <ScheduleDeleteDialog
        deleteTarget={deleteTarget}
        routeName={selectedRoute?.name}
        deleting={deleting}
        setDeleteTarget={setDeleteTarget}
        confirmDelete={confirmDelete}
      />
    </div>
  )
}
