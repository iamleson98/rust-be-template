'use client'

/**
 * Admin — vehicle types panel (`/admin/vehicle-types`).
 *
 * The managed vehicle-class catalog (limousine, sleeper, 11-seater, …)
 * that feeds the schedule form's "Loại xe" picker and the public trip
 * search filter. Searchable + paginated table (offset paging, same
 * pattern as the tickets panel), create/edit dialog and a delete
 * confirmation.
 */

import { useMemo, useState } from 'react'
import { Bus, Loader2, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

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
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  useAdminVehicleTypes,
  useDeleteAdminVehicleType,
} from '@/lib/queries'
import type { AdminVehicleTypeOut } from '@/lib/api/types.gen'

import { VehicleTypeFormDialog } from './vehicle-type-form'

const PAGE_SIZE = 20

export function VehicleTypesPanel() {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editType, setEditType] = useState<AdminVehicleTypeOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminVehicleTypeOut | null>(null)

  const query = useAdminVehicleTypes({
    q: search.trim() || undefined,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })
  const deleteMutation = useDeleteAdminVehicleType()

  const items = (query.data?.items ?? []) as AdminVehicleTypeOut[]
  const total = query.data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  const onSearchChange = (v: string) => {
    setSearch(v)
    setPage(0) // new filter → back to the first page
  }

  const openCreate = () => {
    setEditType(null)
    setDialogOpen(true)
  }

  const openEdit = (t: AdminVehicleTypeOut) => {
    setEditType(t)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } })
      toast.success(`Đã xoá loại xe «${deleteTarget.label}»`)
      setDeleteTarget(null)
    } catch (e: any) {
      toast.error(e?.error?.message ?? e?.message ?? 'Không thể xoá loại xe')
    }
  }

  const busy = deleteMutation.isPending

  return (
    <div className="p-3 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Bus className="h-5 w-5 text-blue-600" />
            Loại xe
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Danh mục loại phương tiện cho form tạo lịch trình và bộ lọc tìm kiếm
            (limousine, giường nằm, xe 11 chỗ…).
          </p>
        </div>
        <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
          <Plus className="h-4 w-4 mr-1.5" />
          Thêm loại xe
        </Button>
      </div>

      {/* Search + pagination bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="relative w-full max-w-xs">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Tìm theo tên hoặc mã…"
            className="pl-9"
          />
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          {query.isFetching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
          <span className="tabular-nums">
            {total > 0 ? `${page * PAGE_SIZE + 1}–${Math.min((page + 1) * PAGE_SIZE, total)} / ${total}` : '0 kết quả'}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || query.isFetching}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Trước
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={page + 1 >= totalPages || query.isFetching}
            onClick={() => setPage((p) => p + 1)}
          >
            Sau
          </Button>
        </div>
      </div>

      {/* Table */}
      {query.isLoading ? (
        <Skeleton className="h-64 w-full" />
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="py-12 flex flex-col items-center text-center gap-2">
            <div className="h-11 w-11 rounded-full bg-blue-50 flex items-center justify-center">
              <Bus className="h-5 w-5 text-blue-600" />
            </div>
            <p className="font-medium">
              {search ? 'Không tìm thấy loại xe nào' : 'Chưa có loại xe nào'}
            </p>
            <p className="text-sm text-muted-foreground max-w-sm">
              {search
                ? 'Thử từ khoá khác.'
                : 'Thêm loại xe đầu tiên để dùng trong form tạo lịch trình.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <Table data-testid="vehicle-types-table">
            <TableHeader>
              <TableRow className="bg-slate-50/80">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Tên hiển thị</TableHead>
                <TableHead>Mã</TableHead>
                <TableHead>Số ghế</TableHead>
                <TableHead>Trạng thái</TableHead>
                <TableHead className="text-right">Thao tác</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((t) => (
                <TableRow key={t.id} className="hover:bg-slate-50/60">
                  <TableCell className="text-xs text-muted-foreground tabular-nums">
                    {t.sortOrder}
                  </TableCell>
                  <TableCell className="font-medium">
                    {t.label}
                    {t.description ? (
                      <p className="text-[11px] text-muted-foreground truncate max-w-[16rem]" title={t.description}>
                        {t.description}
                      </p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                      {t.code}
                    </code>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {t.totalSeats ? `${t.totalSeats} chỗ` : '—'}
                  </TableCell>
                  <TableCell>
                    {t.status === 'active' ? (
                      <Badge variant="outline" className="text-xs border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300">
                        Đang dùng
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs">
                        Đã ẩn
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" onClick={() => openEdit(t)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                        onClick={() => setDeleteTarget(t)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      {/* Create / edit dialog */}
      <VehicleTypeFormDialog
        open={dialogOpen}
        vehicleType={editType}
        onOpenChange={(open) => {
          setDialogOpen(open)
          if (!open) setEditType(null)
        }}
        onSaved={() => {
          setDialogOpen(false)
          setEditType(null)
        }}
      />

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!busy && !open) setDeleteTarget(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Bạn có chắc muốn xoá loại xe{' '}
              <span className="font-semibold text-foreground">
                {deleteTarget?.label}
              </span>
              ? Các lịch trình đang dùng loại xe này sẽ quay lại dùng loại xe
              từ sơ đồ ghế của hãng.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Huỷ</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-rose-600 hover:bg-rose-700"
              onClick={(e) => {
                e.preventDefault()
                void confirmDelete()
              }}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Xoá'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
