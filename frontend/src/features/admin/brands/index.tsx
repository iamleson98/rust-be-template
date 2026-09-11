'use client'

import { useCallback, useMemo, useState } from 'react'
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
import { toast } from 'sonner'
import { Loader2, Trash2 } from 'lucide-react'
import {
  useAdminBrands,
  useAdminRoutes,
  useAdminSchedules,
  useAdminPickupPoints,
  useAdminBusLayouts,
  useDeleteAdminBrand,
  useDeleteAdminRoute,
  useDeleteAdminSchedule,
  useDeleteAdminPickupPoint,
  usePlacesList,
} from '@/lib/queries'
import type { DeleteTarget } from '@/features/admin/types'
import type {
  AdminBrandOut,
  AdminBusLayoutOut,
  AdminPickupPointOut,
  AdminRouteOut,
  AdminScheduleOut,
  PlaceOut,
} from '@/lib/api/types.gen'
import {
  BrandListPanel,
  RouteListPanel,
  ScheduleAndPickupPanel,
  BrandManagementBreadcrumb,
} from './panels'
import { BrandFormDialog } from './brand-form'
import { RouteFormDialog } from '@/features/admin/routes/route-form'
import { ScheduleFormDialog } from '@/features/admin/schedules/schedule-form'
import { PickupPointFormDialog } from '@/features/admin/pickup-points/pickup-form'

export function AdminBrandManagement() {
  const [brandSearch, setBrandSearch] = useState('')
  const [selectedBrand, setSelectedBrand] = useState<AdminBrandOut | null>(null)
  const [routeSearch, setRouteSearch] = useState('')
  const [selectedRoute, setSelectedRoute] = useState<AdminRouteOut | null>(null)
  const [mobileView, setMobileView] = useState<'brands' | 'routes' | 'details'>('brands')
  /* --- queries: brands, places (parallel, on mount) --- */
  const brandsQuery = useAdminBrands()
  const brands: AdminBrandOut[] = (brandsQuery.data?.items ?? []) as AdminBrandOut[]
  const placesQuery = usePlacesList(200)
  const places: PlaceOut[] = (placesQuery.data as any)?.items ?? []
  /* --- queries: routes + bus layouts (when a brand is selected) --- */
  const routesQuery = useAdminRoutes({ brandId: selectedBrand?.id })
  const routes: AdminRouteOut[] = (routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]
  const busLayoutsQuery = useAdminBusLayouts({ brandId: selectedBrand?.id })
  const busLayouts: AdminBusLayoutOut[] = (busLayoutsQuery.data?.items ?? []) as unknown as AdminBusLayoutOut[]
  /* --- queries: schedules + pickup points (when a route is selected) --- */
  const schedulesQuery = useAdminSchedules(selectedRoute?.id)
  const schedules: AdminScheduleOut[] = (schedulesQuery.data?.items ?? []) as unknown as AdminScheduleOut[]
  const pickupPointsQuery = useAdminPickupPoints(selectedRoute?.id)
  const pickupPoints: AdminPickupPointOut[] = (pickupPointsQuery.data?.items ?? []) as unknown as AdminPickupPointOut[]
  /* --- query: addresses of the selected brand (schedule point selects) --- */
  /* --- selection handlers --- */
  const selectBrand = useCallback((brand: AdminBrandOut | null) => {
    setSelectedBrand(brand)
    setSelectedRoute(null)
    if (brand) {
      setMobileView('routes')
    }
  }, [])

  const selectRoute = useCallback((route: AdminRouteOut | null) => {
    setSelectedRoute(route)
    if (route) {
      setMobileView('details')
    }
  }, [])

  /* --- derived: filtered lists (search box) --- */
  const filteredBrands = useMemo(() => {
    const q = brandSearch.trim().toLowerCase()
    if (!q) return brands
    return brands.filter(
      (b) =>
        b.name.toLowerCase().includes(q) ||
        b.slug.toLowerCase().includes(q) ||
        (b.contactPhone ?? '').includes(q),
    )
  }, [brands, brandSearch])

  const filteredRoutes = useMemo(() => {
    const q = routeSearch.trim().toLowerCase()
    if (!q) return routes
    return routes.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.id.toLowerCase().includes(q) ||
        (r.startLocation?.name ?? '').toLowerCase().includes(q) ||
        (r.endLocation?.name ?? '').toLowerCase().includes(q),
    )
  }, [routes, routeSearch])

  /* --- mutations: delete (one per resource kind, auto-invalidates) --- */
  const deleteBrandMutation = useDeleteAdminBrand()
  const deleteRouteMutation = useDeleteAdminRoute()
  const deleteScheduleMutation = useDeleteAdminSchedule()
  const deletePickupMutation = useDeleteAdminPickupPoint()
  /* --- Dialog state --- */
  const [brandDialog, setBrandDialog] = useState<{ open: boolean; brand: AdminBrandOut | null }>({
    open: false,
    brand: null,
  })
  const [routeDialog, setRouteDialog] = useState<{ open: boolean; route: AdminRouteOut | null }>({
    open: false,
    route: null,
  })
  const [scheduleDialog, setScheduleDialog] = useState<{ open: boolean; schedule: AdminScheduleOut | null }>({
    open: false,
    schedule: null,
  })
  const [pickupDialog, setPickupDialog] = useState<{ open: boolean; pickup: AdminPickupPointOut | null }>({
    open: false,
    pickup: null,
  })

  /* --- Delete confirmation --- */
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.kind === 'brand') {
        await deleteBrandMutation.mutateAsync({ path: { id: deleteTarget.id } })
        setSelectedBrand(null)
        setSelectedRoute(null)
      } else if (deleteTarget.kind === 'route') {
        await deleteRouteMutation.mutateAsync({ path: { id: deleteTarget.id } })
        setSelectedRoute(null)
      } else if (deleteTarget.kind === 'schedule') {
        await deleteScheduleMutation.mutateAsync({ path: { id: deleteTarget.id } })
      } else if (deleteTarget.kind === 'pickup') {
        await deletePickupMutation.mutateAsync({ path: { id: deleteTarget.id } })
      }
      toast.success('Đã xoá thành công')
      setDeleteTarget(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể xoá')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className="p-3">
      <BrandManagementBreadcrumb
        selectedBrand={selectedBrand}
        selectedRoute={selectedRoute}
        onBrandsClick={() => {
          setMobileView('brands')
          setSelectedBrand(null)
          setSelectedRoute(null)
        }}
        onRoutesClick={() => {
          setMobileView('routes')
          setSelectedRoute(null)
        }}
      />
      {/* 3-panel layout: stacks on mobile (only the active level is shown) */}
      <div className="grid grid-cols-1 lg:grid-cols-[280px_320px_1fr] gap-4">
        <BrandListPanel
          brandsLoading={brandsQuery.isLoading}
          filteredBrands={filteredBrands}
          brandSearch={brandSearch}
          setBrandSearch={setBrandSearch}
          selectedBrand={selectedBrand}
          onSelectBrand={selectBrand}
          onAdd={() => setBrandDialog({ open: true, brand: null })}
          onEdit={(b) => setBrandDialog({ open: true, brand: b })}
          onDelete={(b) => setDeleteTarget({ kind: 'brand', id: b.id, name: b.name })}
          mobileView={mobileView}
        />
        <RouteListPanel
          routesLoading={routesQuery.isLoading}
          filteredRoutes={filteredRoutes}
          routeSearch={routeSearch}
          setRouteSearch={setRouteSearch}
          selectedBrand={selectedBrand}
          selectedRoute={selectedRoute}
          onSelectRoute={selectRoute}
          onAdd={() => setRouteDialog({ open: true, route: null })}
          onEdit={(r) => setRouteDialog({ open: true, route: r })}
          onDelete={(r) => setDeleteTarget({ kind: 'route', id: r.id, name: r.name })}
          onBack={() => setMobileView('brands')}
          mobileView={mobileView}
        />
        <ScheduleAndPickupPanel
          selectedRoute={selectedRoute}
          schedulesLoading={schedulesQuery.isLoading}
          schedules={schedules}
          pickupLoading={pickupPointsQuery.isLoading}
          pickupPoints={pickupPoints}
          onBack={() => setMobileView('routes')}
          onAddSchedule={() => setScheduleDialog({ open: true, schedule: null })}
          onEditSchedule={(s) => setScheduleDialog({ open: true, schedule: s })}
          onDeleteSchedule={(s) =>
            setDeleteTarget({
              kind: 'schedule',
              id: s.id,
              name: `${s.departureTime} (${s.busLayoutId ?? '—'})`,
            })
          }
          onAddPickup={() => setPickupDialog({ open: true, pickup: null })}
          onEditPickup={(p) => setPickupDialog({ open: true, pickup: p })}
          onDeletePickup={(p) => setDeleteTarget({ kind: 'pickup', id: p.id, name: p.name ?? '—' })}
          mobileView={mobileView}
        />
      </div>
      {/* ─── Dialogs ─── */}
      <BrandFormDialog
        open={brandDialog.open}
        brand={brandDialog.brand}
        onOpenChange={(open) => setBrandDialog({ open, brand: open ? brandDialog.brand : null })}
        onSaved={() => {
          setBrandDialog({ open: false, brand: null })
          // useUpsertAdminBrand invalidates ['admin', 'brands'] → brandsQuery refetches.
        }}
      />
      <RouteFormDialog
        open={routeDialog.open}
        route={routeDialog.route}
        brand={selectedBrand}
        onOpenChange={(open) => setRouteDialog({ open, route: open ? routeDialog.route : null })}
        onSaved={() => {
          setRouteDialog({ open: false, route: null })
        }}
      />
      <ScheduleFormDialog
        open={scheduleDialog.open}
        schedule={scheduleDialog.schedule}
        route={selectedRoute}
        busLayouts={busLayouts}
        brandId={selectedBrand?.id}
        brandName={selectedBrand?.name}
        onOpenChange={(open) =>
          setScheduleDialog({ open, schedule: open ? scheduleDialog.schedule : null })
        }
        onSaved={() => {
          setScheduleDialog({ open: false, schedule: null })
          // useUpsertAdminSchedule invalidates ['admin', 'schedules'] → schedulesQuery refetches.
        }}
      />
      <PickupPointFormDialog
        open={pickupDialog.open}
        pickup={pickupDialog.pickup}
        route={selectedRoute}
        places={places}
        existingCount={pickupPoints.length}
        onOpenChange={(open) => setPickupDialog({ open, pickup: open ? pickupDialog.pickup : null })}
        onSaved={() => {
          setPickupDialog({ open: false, pickup: null })
          // useUpsertAdminPickupPoint invalidates ['admin', 'pickup-points'] → pickupPointsQuery refetches.
        }}
      />
      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!deleting && !open) setDeleteTarget(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xoá <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
              {deleteTarget?.kind === 'brand' && (
                <>
                  {' '}
                  Tất cả tuyến đường, lịch trình, loại xe và điểm đón/trả thuộc hãng này cũng sẽ bị
                  xoá theo.
                </>
              )}
              {deleteTarget?.kind === 'route' && (
                <> Tất cả lịch trình và điểm đón/trả thuộc tuyến này cũng sẽ bị xoá theo.</>
              )}
              {' '}Hành động này không thể hoàn tác.
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
