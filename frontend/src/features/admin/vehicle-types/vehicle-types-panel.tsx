'use client'

/**
 * Admin — vehicle types panel (`/admin/vehicle-types`).
 *
 * The managed vehicle-class catalog (limousine, sleeper, 11-seater, …)
 * that feeds the schedule form's "Loại xe" picker and the public trip
 * search filter. Searchable + paginated table (offset paging, same
 * pattern as the tickets panel) on the shared TanStack Table-based
 * DataTable, create/edit dialog and a delete confirmation.
 */

import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
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
import { Input } from '@/components/ui/input'

import {
  DataTable,
  DataTableColumnHeader,
  type DataTableFeatures,
} from '@/components/data-table'
import {
  useAdminVehicleTypes,
  useDeleteAdminVehicleType,
} from '@/lib/queries'
import type { AdminVehicleTypeOut } from '@/lib/api/types.gen'

import { VehicleTypeFormDialog } from './vehicle-type-form'

const PAGE_SIZE = 20

const columnHelper = createColumnHelper<DataTableFeatures, AdminVehicleTypeOut>()

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

  // Column cells only close over stable setState setters, so the defs
  // themselves are stable (sorting/visibility state is keyed by column
  // id and survives data refreshes).
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('sortOrder', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="#" />,
          cell: ({ getValue }) => (
            <span className="text-xs tabular-nums text-muted-foreground">{getValue()}</span>
          ),
          sortFn: 'basic',
          meta: { label: 'Thứ tự', cellClassName: 'w-14' },
        }),
        columnHelper.accessor('label', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Tên hiển thị" />
          ),
          cell: ({ row }) => (
            <div className="font-medium">
              {row.original.label}
              {row.original.description ? (
                <p
                  className="max-w-[16rem] truncate text-[11px] text-muted-foreground"
                  title={row.original.description}
                >
                  {row.original.description}
                </p>
              ) : null}
            </div>
          ),
          sortFn: 'text',
          meta: { label: 'Tên hiển thị' },
        }),
        columnHelper.accessor('code', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Mã" />,
          cell: ({ getValue }) => (
            <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">
              {getValue()}
            </code>
          ),
          sortFn: 'text',
          meta: { label: 'Mã' },
        }),
        columnHelper.accessor('totalSeats', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Số ghế" />
          ),
          cell: ({ getValue }) => (
            <span className="tabular-nums">{getValue() ? `${getValue()} chỗ` : '—'}</span>
          ),
          sortFn: 'basic',
          meta: { label: 'Số ghế' },
        }),
        columnHelper.accessor('status', {
          header: ({ column }) => (
            <DataTableColumnHeader column={column} title="Trạng thái" />
          ),
          cell: ({ getValue }) =>
            getValue() === 'active' ? (
              <Badge
                variant="outline"
                className="text-xs border-emerald-200 text-emerald-700 dark:border-emerald-800 dark:text-emerald-300"
              >
                Đang dùng
              </Badge>
            ) : (
              <Badge variant="outline" className="text-xs">
                Đã ẩn
              </Badge>
            ),
          sortFn: 'text',
          meta: { label: 'Trạng thái' },
        }),
        columnHelper.display({
          id: 'actions',
          header: 'Thao tác',
          cell: ({ row }) => (
            <div className="flex items-center justify-end gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setEditType(row.original)
                  setDialogOpen(true)
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Sửa loại xe</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50"
                onClick={() => setDeleteTarget(row.original)}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Xoá loại xe</span>
              </Button>
            </div>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: 'Thao tác' },
        }),
      ]),
    [setEditType, setDialogOpen, setDeleteTarget],
  )

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
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            aria-label="Làm mới"
          >
            {query.isFetching ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Bus className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button onClick={openCreate} className="bg-blue-600 hover:bg-blue-700">
            <Plus className="h-4 w-4 mr-1.5" />
            Thêm loại xe
          </Button>
        </div>
      </div>

      {/* Search bar */}
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
      </div>

      {/* Table — the DataTable renders its own bordered surface. */}
      <DataTable
            columns={columns}
            data={items}
            testId="vehicle-types-table"
            rowNoun="loại xe"
            manualPagination
            totalRowCount={total}
            pageIndex={page}
            onPageIndexChange={setPage}
            pageSize={PAGE_SIZE}
            hidePaginationOnSinglePage={false}
            isLoading={query.isLoading}
            isError={query.isError}
            onRetry={() => query.refetch()}
            emptyTitle={search ? 'Không tìm thấy loại xe nào' : 'Chưa có loại xe nào'}
            emptyDescription={
              search
                ? 'Thử từ khoá khác.'
                : 'Thêm loại xe đầu tiên để dùng trong form tạo lịch trình.'
            }
            emptyIcon={<Bus className="h-5 w-5" aria-hidden />}
          />

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
