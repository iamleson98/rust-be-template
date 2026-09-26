'use client'

/**
 * AdminBrandManagement — the /admin/brands page: one subtree table
 * (brands → routes → schedules) with a smart filter bar.
 *
 * Filters:
 *  - free-text brand search (name / slug / phone, diacritic-insensitive)
 *  - route start + end point — "which brands run X → Y?" — served by
 *    the admin routes list's server-side start/end filters; matching
 *    brands auto-expand with their matching routes inline.
 *
 * Schedule rows sort WITHIN each route group (departure time / price /
 * effective date) via the toolbar control — the tree grouping stays
 * fixed, only the schedule leaves reorder.
 *
 * Mutations ride the shared dialogs (BrandFormDialog, RouteFormDialog,
 * ScheduleFormDialog, RoutePickupPointsDialog) + one delete AlertDialog
 * for every level.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ArrowDownUp,
  Building2,
  Loader2,
  MapPin,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useAdminBrands,
  useAdminRoutes,
  useAdminBusLayouts,
  useDeleteAdminBrand,
  useDeleteAdminRoute,
  useDeleteAdminSchedule,
} from '@/lib/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { DeleteTarget } from '@/features/admin/types'
import type {
  AdminBrandOut,
  AdminRouteOut,
  AdminScheduleOut,
} from '@/lib/api/types.gen'
import { CitySelectContent, cityLabel } from '@/features/admin/routes/city-select-content'
import { BrandFormDialog } from './brand-form'
import { RouteFormDialog } from '@/features/admin/routes/route-form'
import { ScheduleFormDialog } from '@/features/admin/schedules/schedule-form'
import { RoutePickupPointsDialog } from './route-pickup-points-dialog'
import { BrandTreeTable, type BrandTreeCallbacks } from './brand-tree-table'
import {
  matchesBrandSearch,
  SCHEDULE_SORT_LABELS,
  type ScheduleSort,
  type ScheduleSortKey,
} from './brand-tree-helpers'
import { getErrorMessage } from '@/lib/error-message'

/** Stable empty default — keeps useMemo deps referentially stable. */
const EMPTY_ITEMS: never[] = []

export function AdminBrandManagement() {
  /* ── Filters ─────────────────────────────────────────────── */
  const [brandSearch, setBrandSearch] = useState('')
  const debouncedSearch = useDebouncedValue(brandSearch, 250)
  const [startLocationId, setStartLocationId] = useState<string>('')
  const [endLocationId, setEndLocationId] = useState<string>('')
  const [scheduleSort, setScheduleSort] = useState<ScheduleSort | null>(null)

  /* ── Expansion state ─────────────────────────────────────── */
  const [expandedBrands, setExpandedBrands] = useState<Set<string>>(new Set())
  const [expandedRoutes, setExpandedRoutes] = useState<Set<string>>(new Set())

  /* ── Queries ─────────────────────────────────────────────── */
  const brandsQuery = useAdminBrands()
  const brands: AdminBrandOut[] = (brandsQuery.data?.items ?? EMPTY_ITEMS) as AdminBrandOut[]

  const locationFilterActive = !!(startLocationId || endLocationId)
  // The smart filter's single cross-brand route query — only fires when
  // at least one endpoint is picked.
  const filteredRoutesQuery = useAdminRoutes(
    locationFilterActive
      ? {
          startLocationId: startLocationId || undefined,
          endLocationId: endLocationId || undefined,
          limit: 200,
        }
      : undefined,
  )
  const filteredRoutes = useMemo(
    () =>
      locationFilterActive
        ? ((filteredRoutesQuery.data?.items ?? []) as unknown as AdminRouteOut[])
        : null,
    [locationFilterActive, filteredRoutesQuery.data],
  )
  const matchingBrandIds = useMemo(
    () => new Set((filteredRoutes ?? []).map((r) => r.brandId ?? '')),
    [filteredRoutes],
  )

  // Brand-level visibility: text search AND (when active) the route
  // location filter.
  const visibleBrands = useMemo(
    () =>
      brands.filter(
        (b) =>
          matchesBrandSearch(b, debouncedSearch) &&
          (!locationFilterActive || matchingBrandIds.has(b.id)),
      ),
    [brands, debouncedSearch, locationFilterActive, matchingBrandIds],
  )

  // Auto-expand matching brands while the location filter is active —
  // collapse to the manual state when it clears. The updater returns
  // the SAME reference when nothing changes, so an unstable
  // `matchingBrandIds` upstream (e.g. keepPreviousData swapping the
  // data object) cannot loop the render.
  useEffect(() => {
    if (!locationFilterActive) {
      // Intentional effect-synced state (filter mode switch —
      // resetting the tree to its collapsed baseline).
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setExpandedBrands(new Set())
      setExpandedRoutes(new Set())
      return
    }
    // Intentional effect-synced state (filter mode switch — see the
    // disable above).
    setExpandedBrands((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const id of matchingBrandIds) {
        if (!next.has(id)) {
          next.add(id)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [locationFilterActive, matchingBrandIds])
  /* ── Mutations ───────────────────────────────────────────── */
  const deleteBrandMutation = useDeleteAdminBrand()
  const deleteRouteMutation = useDeleteAdminRoute()
  const deleteScheduleMutation = useDeleteAdminSchedule()

  /* ── Dialog state ────────────────────────────────────────── */
  const [brandDialog, setBrandDialog] = useState<{ open: boolean; brand: AdminBrandOut | null }>({
    open: false,
    brand: null,
  })
  const [routeDialog, setRouteDialog] = useState<{
    open: boolean
    route: AdminRouteOut | null
    brand: AdminBrandOut | null
  }>({ open: false, route: null, brand: null })
  const [scheduleDialog, setScheduleDialog] = useState<{
    open: boolean
    schedule: AdminScheduleOut | null
    route: AdminRouteOut | null
    brand: AdminBrandOut | null
  }>({ open: false, schedule: null, route: null, brand: null })
  const [pickupRoute, setPickupRoute] = useState<AdminRouteOut | null>(null)

  // Bus layouts for the schedule form — the brand of the route being
  // edited scopes the picker.
  const busLayoutsQuery = useAdminBusLayouts({
    brandId: scheduleDialog.route?.brandId ?? routeDialog.brand?.id ?? undefined,
  })
  const busLayouts = (busLayoutsQuery.data?.items ?? []) as never[]

  /* ── Delete confirmation ─────────────────────────────────── */
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [deleting, setDeleting] = useState(false)

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      if (deleteTarget.kind === 'brand') {
        await deleteBrandMutation.mutateAsync({ path: { id: deleteTarget.id } })
      } else if (deleteTarget.kind === 'route') {
        await deleteRouteMutation.mutateAsync({ path: { id: deleteTarget.id } })
        setExpandedRoutes((prev) => {
          const next = new Set(prev)
          next.delete(deleteTarget.id)
          return next
        })
      } else if (deleteTarget.kind === 'schedule') {
        await deleteScheduleMutation.mutateAsync({ path: { id: deleteTarget.id } })
      }
      toast.success('Đã xoá thành công')
      setDeleteTarget(null)
    } catch (e) {
      toast.error(getErrorMessage(e, 'Không thể xoá'))
    } finally {
      setDeleting(false)
    }
  }

  /* ── Tree callbacks ──────────────────────────────────────── */
  const toggleBrand = useCallback((brandId: string) => {
    setExpandedBrands((prev) => {
      const next = new Set(prev)
      if (next.has(brandId)) next.delete(brandId)
      else next.add(brandId)
      return next
    })
  }, [])

  const toggleRoute = useCallback((routeId: string) => {
    setExpandedRoutes((prev) => {
      const next = new Set(prev)
      if (next.has(routeId)) next.delete(routeId)
      else next.add(routeId)
      return next
    })
  }, [])

  const callbacks: BrandTreeCallbacks = {
    onAddRoute: (brand) => setRouteDialog({ open: true, route: null, brand }),
    onEditRoute: (route, brand) => setRouteDialog({ open: true, route, brand }),
    onDeleteRoute: (route) => setDeleteTarget({ kind: 'route', id: route.id, name: route.name }),
    onAddSchedule: (route, brand) => setScheduleDialog({ open: true, schedule: null, route, brand }),
    onEditSchedule: (schedule, route, brand) =>
      setScheduleDialog({ open: true, schedule, route, brand }),
    onDeleteSchedule: (schedule, route) =>
      setDeleteTarget({
        kind: 'schedule',
        id: schedule.id,
        name: `${schedule.departureTime} · ${route.name}`,
      }),
    onPickupPoints: (route) => setPickupRoute(route),
    onEditBrand: (brand) => setBrandDialog({ open: true, brand }),
    onDeleteBrand: (brand) => setDeleteTarget({ kind: 'brand', id: brand.id, name: brand.name }),
  }

  const clearLocationFilter = () => {
    setStartLocationId('')
    setEndLocationId('')
  }

  const filterSummary = locationFilterActive
    ? `${visibleBrands.length} hãng · ${filteredRoutes?.length ?? 0} tuyến ${
        startLocationId ? cityLabel(startLocationId) : '…'
      } → ${endLocationId ? cityLabel(endLocationId) : '…'}`
    : null

  return (
    <div className="p-3 md:p-4 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-semibold">
            <Building2 className="h-5 w-5 text-blue-600" />
            Hãng xe & Tuyến đường
          </h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Mở rộng từng hãng để quản lý tuyến đường và lịch trình (điểm đón/trả, giờ chạy, giá vé).
          </p>
        </div>
        <Button size="sm" onClick={() => setBrandDialog({ open: true, brand: null })}>
          <Plus className="h-4 w-4" /> Thêm hãng xe
        </Button>
      </div>

      {/* Smart filter bar */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
        <div className="relative w-full lg:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={brandSearch}
            onChange={(e) => setBrandSearch(e.target.value)}
            placeholder="Tìm hãng xe…"
            className="pl-9"
            aria-label="Tìm hãng xe theo tên"
          />
          {brandSearch && (
            <button
              type="button"
              aria-label="Xoá tìm kiếm"
              onClick={() => setBrandSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="min-w-40 flex-1 sm:max-w-56">
            <Select
              value={startLocationId || 'any'}
              onValueChange={(v) => setStartLocationId(v === 'any' ? '' : v)}
            >
              <SelectTrigger className="w-full" aria-label="Điểm đi">
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Điểm đi">
                    {(v: string | null | undefined) =>
                      v === 'any' || !v ? 'Điểm đi (tất cả)' : cityLabel(v) ?? 'Điểm đi'
                    }
                  </SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Điểm đi (tất cả)</SelectItem>
                <CitySelectContent />
              </SelectContent>
            </Select>
          </div>
          <span className="hidden text-xs text-muted-foreground sm:inline" aria-hidden>
            →
          </span>
          <div className="min-w-40 flex-1 sm:max-w-56">
            <Select
              value={endLocationId || 'any'}
              onValueChange={(v) => setEndLocationId(v === 'any' ? '' : v)}
            >
              <SelectTrigger className="w-full" aria-label="Điểm đến">
                <span className="flex min-w-0 items-center gap-2">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Điểm đến">
                    {(v: string | null | undefined) =>
                      v === 'any' || !v ? 'Điểm đến (tất cả)' : cityLabel(v) ?? 'Điểm đến'
                    }
                  </SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="any">Điểm đến (tất cả)</SelectItem>
                <CitySelectContent />
              </SelectContent>
            </Select>
          </div>

          {/* Schedule sort — applies inside every expanded route group */}
          <div className="flex items-center gap-1.5">
            <Select
              value={scheduleSort?.key ?? 'none'}
              onValueChange={(v: string) => {
                if (v === 'none') {
                  setScheduleSort(null)
                  return
                }
                setScheduleSort((prev) =>
                  prev && prev.key === (v as ScheduleSortKey)
                    ? { key: prev.key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                    : { key: v as ScheduleSortKey, dir: 'asc' },
                )
              }}
            >
              <SelectTrigger className="h-9 w-44" aria-label="Sắp xếp lịch trình">
                <span className="flex items-center gap-2">
                  <ArrowDownUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Sắp xếp lịch">
                    {(v: string | null | undefined) =>
                      v === 'none' || !v
                        ? 'Sắp xếp lịch trình'
                        : `${SCHEDULE_SORT_LABELS[v as ScheduleSortKey]} ${
                            scheduleSort?.dir === 'desc' ? '↓' : '↑'
                          }`
                    }
                  </SelectValue>
                </span>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Không sắp xếp</SelectItem>
                {(Object.keys(SCHEDULE_SORT_LABELS) as ScheduleSortKey[]).map((key) => (
                  <SelectItem key={key} value={key}>
                    {SCHEDULE_SORT_LABELS[key]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {locationFilterActive && (
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" className="h-9 gap-1" onClick={clearLocationFilter}>
                <RotateCcw className="h-3.5 w-3.5" /> Xoá lọc
              </Button>
              {filteredRoutesQuery.isLoading ? (
                <Loader2 className="h-4 w-4 animate-spin text-blue-600" aria-label="Đang lọc" />
              ) : (
                <span className="text-xs text-muted-foreground">{filterSummary}</span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* The tree table */}
      <BrandTreeTable
        brands={visibleBrands}
        brandsLoading={brandsQuery.isLoading}
        expandedBrands={expandedBrands}
        onToggleBrand={toggleBrand}
        expandedRoutes={expandedRoutes}
        onToggleRoute={toggleRoute}
        scheduleSort={scheduleSort}
        filteredRoutes={filteredRoutes}
        callbacks={callbacks}
        hasSearch={!!debouncedSearch.trim()}
        hasLocationFilter={locationFilterActive}
      />

      {/* ── Dialogs ── */}
      <BrandFormDialog
        open={brandDialog.open}
        brand={brandDialog.brand}
        onOpenChange={(open) => setBrandDialog({ open, brand: open ? brandDialog.brand : null })}
        onSaved={() => setBrandDialog({ open: false, brand: null })}
      />
      <RouteFormDialog
        open={routeDialog.open}
        route={routeDialog.route}
        brand={routeDialog.brand}
        onOpenChange={(open) => setRouteDialog({ open, route: open ? routeDialog.route : null, brand: routeDialog.brand })}
        onSaved={() => setRouteDialog({ open: false, route: null, brand: null })}
      />
      <ScheduleFormDialog
        open={scheduleDialog.open}
        schedule={scheduleDialog.schedule}
        route={scheduleDialog.route}
        busLayouts={busLayouts}
        brandId={scheduleDialog.brand?.id}
        brandName={scheduleDialog.brand?.name}
        onOpenChange={(open) =>
          setScheduleDialog((prev) =>
            open ? prev : { open: false, schedule: null, route: null, brand: null },
          )
        }
        onSaved={() =>
          setScheduleDialog({ open: false, schedule: null, route: null, brand: null })
        }
      />
      <RoutePickupPointsDialog route={pickupRoute} onOpenChange={() => setPickupRoute(null)} />

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
              Bạn có chắc muốn xoá{' '}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
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
              className="bg-rose-600 text-white hover:bg-rose-700"
            >
              {deleting ? (
                <>
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Đang xoá...
                </>
              ) : (
                <>
                  <Trash2 className="mr-1.5 h-4 w-4" /> Xoá
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
