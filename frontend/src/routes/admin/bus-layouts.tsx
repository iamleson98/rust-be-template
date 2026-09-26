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
import { ComboboxField } from '@/components/ui/combobox'

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
import { useT } from '@/lib/i18n'

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
  const t = useT()
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
      toast.success(t('busLayouts.deleted'))
      setDeleteTarget(null)
    } catch (e) {
      // The backend's 409 guard explains exactly what still references
      // the layout — surface it inside the dialog instead of a toast
      // the user dismisses before reading.
      setDeleteError(getErrorMessage(e, t('busLayouts.deleteFailed')))
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
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('busLayouts.name')} />,
          cell: ({ getValue }) => <span className="font-medium">{getValue() || '—'}</span>,
          sortFn: 'text',
          meta: { label: t('busLayouts.name') },
        }),
        columnHelper.accessor('brandName', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('busLayouts.brand')} />,
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
          meta: { label: t('busLayouts.brand') },
        }),
        columnHelper.accessor('vehicleLabel', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('busLayouts.vehicleType')} />,
          cell: ({ getValue }) =>
            getValue() ? (
              <Badge variant="secondary">{getValue()}</Badge>
            ) : (
              <span className="text-muted-foreground">—</span>
            ),
          sortFn: 'text',
          meta: { label: t('busLayouts.vehicleType') },
        }),
        columnHelper.accessor('seatCount', {
          header: ({ column }) => <DataTableColumnHeader column={column} title={t('adminBusLayouts.seatCount')} />,
          cell: ({ getValue }) => (
            <span className="flex items-center justify-end gap-1 tabular-nums font-semibold">
              <Armchair className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
              {getValue() ?? '—'}
            </span>
          ),
          sortFn: 'basic',
          meta: { label: t('adminBusLayouts.seatCount'), align: 'right' },
        }),
        columnHelper.display({
          id: 'actions',
          header: t('common.actions'),
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
                <span className="sr-only">{t('busLayouts.editTitle')}</span>
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
                <span className="sr-only">{t('adminBusLayouts.deleteLayout')}</span>
              </Button>
            </div>
          ),
          enableSorting: false,
          enableHiding: false,
          meta: { align: 'right', label: t('common.actions') },
        }),
      ]),
    [itemById, t],
  )

  return (
    <div className="page-transition p-3 md:p-6 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <LayoutGrid className="h-5 w-5 text-blue-600" />
            {t('busLayouts.title')}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t('adminBusLayouts.pageSubtitle')}
          </p>
        </div>
        <Button size="sm" onClick={openCreate}>
          <Plus className="h-4 w-4" /> {t('busLayouts.add')}
        </Button>
      </div>

      {/* Brand filter */}
      <div className="w-full sm:w-64">
        <div className="flex items-center gap-2">
          <Bus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <ComboboxField
            value={brandId ?? 'all'}
            onValueChange={(v) => {
              setBrandId(v === 'all' ? undefined : v)
              setPage(0)
            }}
            items={[
              { value: 'all', label: t('busLayouts.allBrands') },
              ...brands.map((b) => ({ value: b.id, label: b.name })),
            ]}
            className="flex-1"
            placeholder={t('busLayouts.allBrands')}
            searchPlaceholder={t('adminBusLayouts.searchBrand')}
            aria-label={t('adminBusLayouts.filterByBrand')}
            data-testid="brand-filter"
          />
        </div>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        rowNoun={t('adminBusLayouts.rowNoun')}
        manualPagination
        totalRowCount={total}
        pageIndex={page}
        onPageIndexChange={setPage}
        pageSize={PAGE_SIZE}
        isLoading={isLoading}
        emptyTitle={t('busLayouts.empty')}
        emptyDescription={t('adminBusLayouts.emptyDesc')}
        emptyIcon={<LayoutGrid className="h-5 w-5" aria-hidden />}
        emptyAction={
          <Button size="sm" className="mt-2" onClick={openCreate}>
            <Plus className="h-4 w-4" /> {t('busLayouts.add')}
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
            <AlertDialogTitle>{t('common.confirmDeleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('adminBusLayouts.deleteLayout')}{' '}
              <span className="font-semibold text-foreground">
                {deleteTarget?.name ?? '—'}
                {deleteTarget?.totalSeats
                  ? t('adminBusLayouts.seatsParens', { count: deleteTarget.totalSeats })
                  : ''}
              </span>
              {t('adminBusLayouts.deleteConfirmTail')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deleteError && (
            <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:border-rose-900 dark:bg-rose-950 dark:text-rose-300">
              {deleteError}
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {deleteError ? t('common.close') : t('common.cancel')}
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
                    <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> {t('common.deleting')}
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-1.5 h-4 w-4" /> {t('common.delete')}
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
