'use client'

/**
 * Admin route — `/admin/routes` — route management page.
 *
 * Focused view over the route entity: brand filter (routes belong to a
 * brand), search, a table with start/end city + schedule/pickup counts,
 * and the shared RouteFormDialog + delete confirmation. The full
 * brand → route → schedule master-detail remains at `/admin/brands`.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { createColumnHelper } from '@tanstack/react-table'
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
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import { ArrowRight, CalendarDays, Loader2, MapPin, Pencil, Plus, Route as RouteIcon, Search, Trash2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminBrands, useAdminRoutes, useDeleteAdminRoute } from '@/lib/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { AdminBrandOut, AdminRouteOut } from '@/lib/api/types.gen'
import { AdminShell } from '@/components/layout/admin-shell'
import { RouteFormDialog } from '@/components/admin/routes/route-form'
import { VIETNAMESE_CITIES } from '@/lib/vietnamese-cities'

const CITY_NAME_BY_ID = new Map<string, string>(VIETNAMESE_CITIES.map((c) => [c.id, c.name]))
const cityLabel = (slug: string | null | undefined) =>
  slug ? CITY_NAME_BY_ID.get(slug) ?? slug : '—'

function BrandDot({ color }: { color?: string | null }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full shrink-0"
      style={{ backgroundColor: color ?? '#94a3b8' }}
    />
  )
}

const routeColumnHelper = createColumnHelper<DataTableFeatures, AdminRouteOut>()

/** Server-side page size for the routes table. */
const PAGE_SIZE = 20

export function AdminRoutesPage() {
  const navigate = useNavigate()
  const [brandId, setBrandId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRoute, setEditRoute] = useState<AdminRouteOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminRouteOut | null>(null)
  const [deleting, setDeleting] = useState(false)

  // Server-side search: keystrokes are debounced into the query key so
  // the API only sees one request per settled term (the backend matches
  // the route name, both city slugs and the brand's name).
  const debouncedSearch = useDebouncedValue(search, 300)
  useEffect(() => {
    setPage(0)
  }, [debouncedSearch, brandId])

  const brandsQuery = useAdminBrands()
  const brands: AdminBrandOut[] = (brandsQuery.data?.items ?? []) as unknown as AdminBrandOut[]
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId],
  )

  const routesQuery = useAdminRoutes({
    brandId,
    q: debouncedSearch.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const routes: AdminRouteOut[] = (routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]
  const total = routesQuery.data?.total ?? 0
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands])

  const deleteMutation = useDeleteAdminRoute()
  // Columns close over the brand map (icon color + name) and stable setters.
  const columns = useMemo(
    () =>
      routeColumnHelper.columns([
        routeColumnHelper.accessor('name', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Tên tuyến" />
          ),
          cell: ({ getValue }) => (
            <span className="block max-w-[220px] truncate font-medium">{getValue()}</span>
          ),
          sortFn: 'text',
          meta: { label: 'Tên tuyến' },
        }),
        routeColumnHelper.accessor((r) => brandById.get(r.brandId ?? '')?.name ?? '', {
          id: 'brand',
          header: ({ column }) => <DataTableColumnHeader column={column} title="Hãng" />,
          cell: ({ row }) => {
            const brand = brandById.get(row.original.brandId ?? '')
            return brand ? (
              <span className="flex items-center gap-1.5">
                <BrandDot color={brand.accentColor} />
                <span className="max-w-[180px] truncate">{brand.name}</span>
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          },
          sortFn: 'text',
          meta: { label: 'Hãng' },
        }),
        routeColumnHelper.display({
          id: 'cities',
          header: 'Điểm đi → Điểm đến',
          cell: ({ row }) => (
            <span className="flex items-center gap-1.5 text-sm">
              <MapPin className="h-3.5 w-3.5 shrink-0 text-blue-600" />
              <span className="max-w-[130px] truncate">
                {cityLabel(row.original.startLocationId)}
              </span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <MapPin className="h-3.5 w-3.5 shrink-0 text-rose-600" />
              <span className="max-w-[130px] truncate">
                {cityLabel(row.original.endLocationId)}
              </span>
            </span>
          ),
          meta: { label: 'Điểm đi → Điểm đến' },
        }),
        routeColumnHelper.accessor('scheduleCount', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Lịch trình" />
          ),
          cell: ({ getValue }) => (
            <Badge variant="secondary" className="tabular-nums">
              {getValue()}
            </Badge>
          ),
          sortFn: 'basic',
          meta: { label: 'Lịch trình', align: 'center' },
        }),
        routeColumnHelper.accessor('pickupPointCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Điểm đón" />,
          cell: ({ getValue }) => (
            <Badge variant="outline" className="tabular-nums">
              {getValue()}
            </Badge>
          ),
          sortFn: 'basic',
          meta: { label: 'Điểm đón', align: 'center' },
        }),
        routeColumnHelper.display({
          id: 'actions',
          header: 'Thao tác',
          cell: ({ row }) => (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => {
                  setEditRoute(row.original)
                  setDialogOpen(true)
                }}
                aria-label="Sửa tuyến"
              >
                <Pencil className="h-4 w-4" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                onClick={() => setDeleteTarget(row.original)}
                aria-label="Xoá tuyến"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: 'Thao tác' },
        }),
      ]),
    [brandById, setEditRoute, setDialogOpen, setDeleteTarget],
  )

  const openCreate = () => {
    if (!selectedBrand) {
      toast.error('Chọn hãng xe trước khi thêm tuyến')
      return
    }
    setEditRoute(null)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } })
      toast.success('Đã xoá tuyến')
      setDeleteTarget(null)
    } catch (e: any) {
      toast.error(e?.message ?? 'Không thể xoá tuyến')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <AdminShell>
      <div className="p-3 md:p-6 space-y-4">
        {/* Header */}
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold flex items-center gap-2">
              <RouteIcon className="h-5 w-5 text-blue-600" />
              Tuyến đường
            </h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Quản lý tuyến của các hãng — mỗi tuyến chứa lịch trình và điểm đón/trả.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate({ to: '/admin/schedules' as any })}>
              <CalendarDays className="h-4 w-4 mr-1.5" /> Lịch trình
            </Button>
            <Button size="sm" onClick={openCreate} disabled={!selectedBrand}>
              <Plus className="h-4 w-4 mr-1.5" /> Thêm tuyến
            </Button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="w-full sm:w-64">
            <Select value={brandId ?? 'all'} onValueChange={(v) => setBrandId(v === 'all' ? undefined : v)}>
              <SelectTrigger className="w-full">
                <span className="flex items-center gap-2 min-w-0">
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <SelectValue placeholder="Tất cả hãng">
                    {(v: string | null | undefined) =>
                      v === 'all' || !v
                        ? 'Tất cả hãng'
                        : brandById.get(v)?.name ?? 'Hãng'}
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
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm tuyến, thành phố…"
              className="pl-9"
            />
          </div>
        </div>

        {/* Table — the DataTable renders its own bordered surface and
            swaps in the mobile card list below `md`, sharing the
            loading/empty states and the pagination footer. */}
        <DataTable
          columns={columns}
          data={routes}
          rowNoun="tuyến"
          manualPagination
          totalRowCount={total}
          pageIndex={page}
          onPageIndexChange={setPage}
          pageSize={PAGE_SIZE}
          hidePaginationOnSinglePage={false}
          isLoading={routesQuery.isLoading}
          emptyTitle="Chưa có tuyến đường nào"
          emptyDescription={
            selectedBrand
              ? `Hãng ${selectedBrand.name} chưa có tuyến. Thêm tuyến đầu tiên để bắt đầu tạo lịch trình.`
              : 'Chọn một hãng hoặc thêm tuyến mới để bắt đầu.'
          }
          emptyIcon={<RouteIcon className="h-5 w-5" aria-hidden />}
          emptyAction={
            selectedBrand ? (
              <Button size="sm" className="mt-2" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5" /> Thêm tuyến
              </Button>
            ) : null
          }
          mobileList={
            <div className="divide-y">
              {routes.map((r) => {
                const brand = brandById.get(r.brandId ?? '')
                return (
                  <div key={r.id} className="p-3 flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                        {brand ? (
                          <>
                            <BrandDot color={brand.accentColor} />
                            <span className="truncate">{brand.name}</span>
                            <span>·</span>
                          </>
                        ) : null}
                        {cityLabel(r.startLocationId)} → {cityLabel(r.endLocationId)}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.scheduleCount} lịch trình · {r.pickupPointCount} điểm đón
                      </p>
                    </div>
                    <div className="flex flex-col gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => {
                          setEditRoute(r)
                          setDialogOpen(true)
                        }}
                        aria-label="Sửa tuyến"
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-muted-foreground hover:text-rose-600"
                        onClick={() => setDeleteTarget(r)}
                        aria-label="Xoá tuyến"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          }
        />
      </div>

      {/* Create / edit */}
      <RouteFormDialog
        open={dialogOpen}
        route={editRoute}
        brand={selectedBrand}
        onOpenChange={(open) => setDialogOpen(open)}
        onSaved={() => setDialogOpen(false)}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!deleting && !open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xoá tuyến{' '}
              <span className="font-semibold text-foreground">{deleteTarget?.name}</span>?
              Tất cả lịch trình và điểm đón/trả thuộc tuyến này cũng sẽ bị xoá theo.
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
    </AdminShell>
  )
}
