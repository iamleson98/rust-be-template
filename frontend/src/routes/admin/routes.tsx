'use client'

/**
 * Admin route — `/admin/routes` — route management page.
 *
 * Focused view over the route entity: brand filter (routes belong to a
 * brand), search, a table with start/end city + schedule/pickup counts,
 * and the shared RouteFormDialog + delete confirmation. The full
 * brand → route → schedule master-detail remains at `/admin/brands`.
 */

import { useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { ArrowRight, CalendarDays, Loader2, MapPin, Pencil, Plus, Route as RouteIcon, Search, Trash2, Building2 } from 'lucide-react'
import { toast } from 'sonner'
import { useAdminBrands, useAdminRoutes, useDeleteAdminRoute } from '@/lib/queries'
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

export function AdminRoutesPage() {
  const navigate = useNavigate()
  const [brandId, setBrandId] = useState<string | undefined>(undefined)
  const [search, setSearch] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editRoute, setEditRoute] = useState<AdminRouteOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminRouteOut | null>(null)
  const [deleting, setDeleting] = useState(false)

  const brandsQuery = useAdminBrands()
  const brands: AdminBrandOut[] = (brandsQuery.data?.items ?? []) as unknown as AdminBrandOut[]
  const selectedBrand = useMemo(
    () => brands.find((b) => b.id === brandId) ?? null,
    [brands, brandId],
  )

  const routesQuery = useAdminRoutes(brandId)
  const routes: AdminRouteOut[] = (routesQuery.data?.items ?? []) as unknown as AdminRouteOut[]
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return routes
    return routes.filter((r) => {
      const brandName = brandById.get(r.brandId ?? '')?.name ?? ''
      return (
        r.name.toLowerCase().includes(q) ||
        brandName.toLowerCase().includes(q) ||
        (cityLabel(r.startLocationId)?.toLowerCase().includes(q) ?? false) ||
        (cityLabel(r.endLocationId)?.toLowerCase().includes(q) ?? false)
      )
    })
  }, [routes, search, brandById])

  const deleteMutation = useDeleteAdminRoute()

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

        {/* Table */}
        {routesQuery.isLoading ? (
          <Skeleton className="h-72 w-full" />
        ) : filtered.length === 0 ? (
          <Card>
            <CardContent className="py-12 flex flex-col items-center text-center gap-2">
              <div className="h-11 w-11 rounded-full bg-blue-50 flex items-center justify-center">
                <RouteIcon className="h-5 w-5 text-blue-600" />
              </div>
              <p className="font-medium">Chưa có tuyến đường nào</p>
              <p className="text-sm text-muted-foreground max-w-sm">
                {selectedBrand
                  ? `Hãng ${selectedBrand.name} chưa có tuyến. Thêm tuyến đầu tiên để bắt đầu tạo lịch trình.`
                  : 'Chọn một hãng hoặc thêm tuyến mới để bắt đầu.'}
              </p>
              {selectedBrand ? (
                <Button size="sm" className="mt-1" onClick={openCreate}>
                  <Plus className="h-4 w-4 mr-1.5" /> Thêm tuyến
                </Button>
              ) : null}
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <CardHeader className="py-3 border-b">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {filtered.length} tuyến
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-slate-50/80">
                      <TableHead>Tên tuyến</TableHead>
                      <TableHead>Hãng</TableHead>
                      <TableHead>Điểm đi → Điểm đến</TableHead>
                      <TableHead className="text-center">Lịch trình</TableHead>
                      <TableHead className="text-center">Điểm đón</TableHead>
                      <TableHead className="text-right">Thao tác</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filtered.map((r) => {
                      const brand = brandById.get(r.brandId ?? '')
                      return (
                        <TableRow key={r.id} className="hover:bg-slate-50/60">
                          <TableCell className="font-medium max-w-[220px]">
                            <span className="block truncate">{r.name}</span>
                          </TableCell>
                          <TableCell>
                            {brand ? (
                              <span className="flex items-center gap-1.5">
                                <BrandDot color={brand.accentColor} />
                                <span className="truncate max-w-[180px]">{brand.name}</span>
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </TableCell>
                          <TableCell>
                            <span className="flex items-center gap-1.5 text-sm">
                              <MapPin className="h-3.5 w-3.5 text-blue-600 shrink-0" />
                              <span className="truncate max-w-[130px]">{cityLabel(r.startLocationId)}</span>
                              <ArrowRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <MapPin className="h-3.5 w-3.5 text-rose-600 shrink-0" />
                              <span className="truncate max-w-[130px]">{cityLabel(r.endLocationId)}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="secondary" className="tabular-nums">
                              {r.scheduleCount}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-center">
                            <Badge variant="outline" className="tabular-nums">
                              {r.pickupPointCount}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right">
                            <div className="flex items-center justify-end gap-1">
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
                                className="h-8 w-8 text-muted-foreground hover:text-rose-600 hover:bg-rose-50"
                                onClick={() => setDeleteTarget(r)}
                                aria-label="Xoá tuyến"
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                      )
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile list */}
              <div className="md:hidden divide-y">
                {filtered.map((r) => {
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
            </CardContent>
          </Card>
        )}
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
