'use client'

/**
 * Admin route — `/admin/routes` — route management page.
 *
 * Focused view over the route entity: brand filter (routes belong to a
 * brand), search, a table with start/end city + schedule/pickup counts,
 * and the shared RouteFormDialog + delete confirmation. The full
 * brand → route → schedule master-detail remains at `/admin/brands`.
 *
 * The column model, mobile cards and the delete dialog live in
 * `src/features/admin/routes/`; this file is the thin page shell
 * (data wiring + layout).
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { DataTable } from '@/components/data-table'
import { Building2, CalendarDays, Plus, Route as RouteIcon, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminBrands, useAdminRoutes, useDeleteAdminRoute } from '@/lib/queries'
import { useDebouncedValue } from '@/hooks/use-debounced-value'
import type { AdminBrandOut, AdminRouteOut } from '@/lib/api/types.gen'
import { RouteFormDialog } from '@/features/admin/routes/route-form'
import { BrandDot } from '@/features/admin/brand-dot'
import { RouteMobileCard } from '@/features/admin/routes/route-card'
import { RouteDeleteDialog } from '@/features/admin/routes/route-delete-dialog'
import { useRouteColumns } from '@/features/admin/routes/route-columns'

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
  const columns = useRouteColumns({ brandById, setEditRoute, setDialogOpen, setDeleteTarget })

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
    <div className="page-transition p-3 md:p-6 space-y-4">
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
                      : brandById.get(v)?.name ?? 'Hãng'
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
            {routes.map((r) => (
              <RouteMobileCard
                key={r.id}
                route={r}
                brand={brandById.get(r.brandId ?? '')}
                onEdit={(route) => {
                  setEditRoute(route)
                  setDialogOpen(true)
                }}
                onDelete={setDeleteTarget}
              />
            ))}
          </div>
        }
      />

      {/* Create / edit */}
      <RouteFormDialog
        open={dialogOpen}
        route={editRoute}
        brand={selectedBrand}
        onOpenChange={(open) => setDialogOpen(open)}
        onSaved={() => setDialogOpen(false)}
      />

      {/* Delete confirmation */}
      <RouteDeleteDialog
        deleteTarget={deleteTarget}
        deleting={deleting}
        setDeleteTarget={setDeleteTarget}
        confirmDelete={confirmDelete}
      />
    </div>
  )
}
