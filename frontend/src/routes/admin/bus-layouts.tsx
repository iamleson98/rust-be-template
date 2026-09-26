'use client'

/**
 * Admin route — `/admin/bus-layouts` — seat-layout catalog page.
 *
 * Full CRUD over the bus-layout catalog:
 *  - server-side paginated table (brand filter + total-driven footer)
 *  - create with the seat-grid generator dialog (live preview)
 *  - metadata edit (the grid itself is immutable after create)
 *  - guarded delete — the backend blocks layouts still wired into
 *    schedules or carrying trip inventory / sold tickets with a
 *    descriptive 409 that is surfaced in the confirm dialog.
 */

import { useMemo, useState } from 'react'
import { createColumnHelper } from '@tanstack/react-table'
import { Armchair, Bus, LayoutGrid, Loader2, Pencil, Plus, Trash2 } from 'lucide-react'
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

import { DataTable, DataTableColumnHeader, type DataTableFeatures } from '@/components/data-table'
import {
  useAdminBrands,
  useAdminBusLayouts,
  useDeleteAdminBusLayout,
} from '@/lib/queries'
import type { AdminBusLayoutOut } from '@/lib/api/types.gen'

import { BusLayoutFormDialog } from '@/features/admin/bus-layouts/bus-layout-form'
import { BrandDot } from '@/features/admin/brand-dot'
import { vehicleCodeLabel } from '@/features/admin/brands/brand-tree-helpers'
import { getErrorMessage } from '@/lib/error-message'

/** Server-side page size for the bus-layouts table. */
const PAGE_SIZE = 20

interface BusLayoutRow {
  id: string
  name: string
  brandId: string | null
  brandName: string | null
  brandColor: string | null
  vehicleType: string | null
  vehicleLabel: string | null
  seatCount: number | null
}

const columnHelper = createColumnHelper<DataTableFeatures, BusLayoutRow>()

export function AdminBusLayoutsPage() {
  const [page, setPage] = useState(0)
  const [brandId, setBrandId] = useState<string | undefined>(undefined)

  const [dialogOpen, setDialogOpen] = useState(false)
  const [editLayout, setEditLayout] = useState<AdminBusLayoutOut | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<AdminBusLayoutOut | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const brandsQuery = useAdminBrands()
  const brands = useMemo(
    () => (brandsQuery.data?.items ?? []) as { id: string; name: string; accentColor?: string | null }[],
    [brandsQuery.data],
  )
  const brandById = useMemo(() => new Map(brands.map((b) => [b.id, b])), [brands])

  const { data, isLoading } = useAdminBusLayouts({
    brandId,
    limit: PAGE_SIZE,
    offset: page * PAGE_SIZE,
  })

  const deleteMutation = useDeleteAdminBusLayout()

  const items: AdminBusLayoutOut[] = useMemo(
    () => (data?.items ?? []) as AdminBusLayoutOut[],
    [data],
  )
  const itemById = useMemo(() => new Map(items.map((l) => [l.id, l])), [items])
  const total = data?.total ?? 0

  const rows: BusLayoutRow[] = items.map((layout) => {
    const brand = layout.brandId ? brandById.get(layout.brandId) : undefined
    return {
      id: layout.id,
      name: layout.name ?? '',
      brandId: layout.brandId ?? null,
      brandName: brand?.name ?? null,
      brandColor: brand?.accentColor ?? null,
      vehicleType: layout.vehicleType ?? null,
      vehicleLabel: layout.vehicleType ? vehicleCodeLabel(layout.vehicleType) : null,
      seatCount: layout.totalSeats ?? null,
    }
  })

  const openCreate = () => {
    setEditLayout(null)
    setDialogOpen(true)
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      await deleteMutation.mutateAsync({ path: { id: deleteTarget.id } })
      toast.success('Đã xoá sơ đồ ghế')
      setDeleteTarget(null)
    } catch (e) {
      // The backend's 409 guard explains exactly what still references
      // the layout — surface it inside the dialog instead of a toast
      // the user dismisses before reading.
      setDeleteError(getErrorMessage(e, 'Không thể xoá sơ đồ ghế'))
    } finally {
      setDeleting(false)
    }
  }

  // Column cells only close over stable setters + memoized lookups, so
  // the defs themselves stay stable across data refreshes.
  const columns = useMemo(
    () =>
      columnHelper.columns([
        columnHelper.accessor('name', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Tên sơ đồ" />,
          cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span>,
          sortFn: 'text',
          meta: { label: 'Tên sơ đồ' },
        }),
        columnHelper.accessor('brandName', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Hãng xe" />,
          cell: ({ getValue, row }) => {
            const name = getValue()
            if (!name) return <span className="text-muted-foreground">—</span>
            return (
              <span className="flex items-center gap-2">
                <BrandDot color={row.original.brandColor ?? undefined} />
                {name}
              </span>
            )
          },
          sortFn: 'text',
          meta: { label: 'Hãng xe' },
        }),
        columnHelper.accessor('vehicleLabel', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Loại xe" />,
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant="secondary">{getValue()}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          sortFn: 'text',
          meta: { label: 'Loại xe' },
        }),
        columnHelper.accessor('seatCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title="Số ghế" />,
          cell: ({ getValue }) => (
            <span className="flex items-center justify-end gap-1 tabular-nums font-semibold">
              <Armchair className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {getValue() ?? '—'}
            </span>
          ),
          sortFn: 'basic',
          meta: { label: 'Số ghế', align: 'right' },
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
                  const original = itemById.get(row.original.id)
                  if (original) {
                    setEditLayout(original)
                    setDialogOpen(true)
                  }
                }}
              >
                <Pencil className="h-3.5 w-3.5" />
                <span className="sr-only">Sửa sơ đồ ghế</span>
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950"
                onClick={() => {
                  const original = itemById.get(row.original.id)
                  if (original) {
                    setDeleteError(null)
                    setDeleteTarget(original)
                  }
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span className="sr-only">Xoá sơ đồ ghế</span>
              </Button>
            </div>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: 'Thao tác' },
        }),
      ]),
    [itemById],
  )

  return (
    <div className="page-transition p-3 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-600" />
            Sơ đồ ghế
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Các sơ đồ ghế của hãng xe dùng để chọn chỗ khi đặt vé — tạo mới kèm lưới ghế tự động.
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> Thêm sơ đồ ghế
        </Button>
      </div>

      {/* Brand filter */}
      <div className="w-full sm:w-64">
        <Select
          value={brandId ?? 'all'}
          onValueChange={(v) => {
            setBrandId(v === 'all' ? undefined : v)
            setPage(0)
          }}
        >
          <SelectTrigger className="w-full" aria-label="Lọc theo hãng">
            <span className="flex min-w-0 items-center gap-2">
              <Bus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <SelectValue placeholder="Tất cả hãng">
                {(v: string | null | undefined) =>
                  v === 'all' || !v ? 'Tất cả hãng' : brandById.get(v)?.name ?? 'Hãng'
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

      <DataTable
        columns={columns}
        data={rows}
        rowNoun="sơ đồ"
        manualPagination
        totalRowCount={total}
        pageIndex={page}
        onPageIndexChange={setPage}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        emptyTitle="Chưa có sơ đồ ghế nào"
        emptyDescription="Thêm sơ đồ ghế đầu tiên — chọn lưới ghế, hệ thống tự sinh các ghế để bán vé."
        emptyIcon={<LayoutGrid className="h-5 w-5" aria-hidden />}
        emptyAction={
          <Button size="sm" className="mt-2" onClick={openCreate}>
            <Plus className="h-4 w-4" /> Thêm sơ đồ ghế
          </Button>
        }
      />

      {/* Create / edit */}
      <BusLayoutFormDialog
        open={dialogOpen}
        layout={editLayout}
        onOpenChange={(open) => setDialogOpen(open)}
        onSaved={() => setDialogOpen(false)}
      />

      {/* Delete confirmation */}
      <AlertDialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!deleting && !open) {
            setDeleteTarget(null)
            setDeleteError(null)
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Xác nhận xoá</AlertDialogTitle>
            <AlertDialogDescription>
              Xoá sơ đồ ghế{' '}
              <span className="font-semibold text-foreground">
                {deleteTarget?.name ?? '—'}
                {deleteTarget?.totalSeats ? ` (${deleteTarget.totalSeats} ghế)` : ''}
              </span>
              ? Các ghế của sơ đồ cũng sẽ bị xoá. Hành động này không thể hoàn tác.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
              {deleteError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {deleteError ? 'Đóng' : 'Huỷ'}
            </AlertDialogCancel>
            {!deleteError && (
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
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
