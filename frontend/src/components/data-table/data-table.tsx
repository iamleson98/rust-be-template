'use client'

/**
 * Core data table following the official shadcn data-table guide
 * (https://ui.shadcn.com/docs/components/base/data-table), adapted to this
 * project's design system: Vietnamese empty/error states, the shared
 * `dataTableFeatures` set, and built-in support for both client-side and
 * server-side ("manual") pagination + sorting.
 *
 * Conventions:
 *  - The table renders inside the official `overflow-hidden rounded-lg
 *    border` surface (no shadow — admin screens stay flat; disable with
 *    `bordered={false}` when a parent Card already provides the surface).
 *  - While `isLoading` the component renders a STRUCTURE-MATCHED
 *    shimmer skeleton (header row + body rows + pagination footer) —
 *    never the real table headers/cells with skeleton fillers.
 *  - Column alignment/responsive classes come from `meta: { align,
 *    headerClassName, cellClassName }` so every table renders identically.
 *  - Rows are optional click targets (`onRowClick`): they get
 *    `cursor-pointer`, a keyboard handler and an accessible label.
 *  - Sorting/pagination state lives here unless the caller controls it —
 *    server-backed tables pass `manualPagination` + `pageIndex`/`rowCount`
 *    (and optionally `manualSorting` + `sorting`).
 */

import { useState, type ReactNode } from 'react'
import {
  FlexRender,
  useTable,
  type ColumnDef,
  type ColumnVisibilityState,
  type CellData,
  type PaginationState,
  type ReactTable,
  type RowData,
  type SortingState,
} from '@tanstack/react-table'
import { AlertCircle, Inbox } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Shimmer } from '@/components/ui/shimmer'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import { cn } from '@/lib/utils'
import {
  dataTableFeatures,
  type DataTableColumnMeta,
  type DataTableFeatures,
} from './data-table-features'
import { DataTablePagination } from './data-table-pagination'

const ALIGN_CLASSES = {
  left: 'text-left',
  center: 'text-center',
  right: 'text-right',
} as const

export interface DataTableProps<TData extends RowData> {
  columns: ColumnDef<DataTableFeatures, TData, CellData>[]
  data: TData[]

  // ── Row interaction ─────────────────────────────────────────
  onRowClick?: (row: TData) => void
  rowAriaLabel?: (row: TData) => string
  rowClassName?: string | ((row: TData) => string)
  getRowId?: (row: TData, index: number) => string

  // ── Sorting (client-side unless `manualSorting`) ────────────
  manualSorting?: boolean
  sorting?: SortingState
  onSortingChange?: (sorting: SortingState) => void
  defaultSorting?: SortingState

  // ── Pagination (client-side unless `manualPagination`) ──────
  manualPagination?: boolean
  /** Total row count across all pages (required for manual pagination). */
  totalRowCount?: number
  pageIndex?: number
  onPageIndexChange?: (pageIndex: number) => void
  pageSize?: number
  onPageSizeChange?: (pageSize: number) => void
  showPageSize?: boolean
  pageSizeOptions?: number[]
  defaultPageSize?: number
  /** Render nothing for the footer (e.g. short lists like run history). */
  hidePagination?: boolean
  hidePaginationOnSinglePage?: boolean
  /** Vietnamese noun for the "Hiển thị X–Y / N <noun>" label. */
  rowNoun?: string

  // ── Async UX ────────────────────────────────────────────────
  isLoading?: boolean
  skeletonRows?: number
  isError?: boolean
  onRetry?: () => void

  // ── Empty state ─────────────────────────────────────────────
  emptyTitle?: string
  emptyDescription?: string
  emptyIcon?: ReactNode
  emptyAction?: ReactNode

  // ── Layout ──────────────────────────────────────────────────
  /** Render the official `rounded-lg border` surface around the table. */
  bordered?: boolean
  /** Rendered above the table — receives the table instance (e.g. column menu). */
  toolbar?: (table: ReactTable<DataTableFeatures, TData>) => ReactNode
  /**
   * Optional mobile card list — replaces the table on small screens while
   * states (skeleton/error/empty) and the pagination footer stay shared.
   */
  mobileList?: ReactNode
  className?: string
  testId?: string
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  onRowClick,
  rowAriaLabel,
  rowClassName,
  getRowId,
  manualSorting,
  sorting: sortingProp,
  onSortingChange,
  defaultSorting,
  manualPagination,
  totalRowCount,
  pageIndex: pageIndexProp,
  onPageIndexChange,
  pageSize: pageSizeProp,
  onPageSizeChange,
  showPageSize,
  pageSizeOptions,
  defaultPageSize = 10,
  hidePagination,
  hidePaginationOnSinglePage,
  rowNoun,
  isLoading,
  skeletonRows = 6,
  isError,
  onRetry,
  emptyTitle = 'Không có dữ liệu',
  emptyDescription,
  emptyIcon,
  emptyAction,
  bordered = true,
  toolbar,
  mobileList,
  className,
  testId,
}: DataTableProps<TData>) {
  const [internalSorting, setInternalSorting] = useState<SortingState>(defaultSorting ?? [])
  const [internalPagination, setInternalPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: defaultPageSize,
  })
  const [columnVisibility, setColumnVisibility] = useState<ColumnVisibilityState>({})

  const sorting = sortingProp ?? internalSorting
  const controlledPagination =
    pageIndexProp !== undefined
      ? { pageIndex: pageIndexProp, pageSize: pageSizeProp ?? defaultPageSize }
      : internalPagination

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    getRowId: getRowId ?? ((row, index) => {
      const id = (row as { id?: unknown }).id
      return id == null ? String(index) : String(id)
    }),
    manualPagination,
    manualSorting,
    autoResetPageIndex: !manualPagination,
    rowCount: manualPagination ? totalRowCount : undefined,
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function' ? (updater as (prev: SortingState) => SortingState)(sorting) : updater
      if (onSortingChange) {
        onSortingChange(next)
      } else {
        setInternalSorting(next)
      }
    },
    onPaginationChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? (updater as (prev: PaginationState) => PaginationState)(controlledPagination)
          : updater
      if (onPageIndexChange || onPageSizeChange) {
        onPageIndexChange?.(next.pageIndex)
        onPageSizeChange?.(next.pageSize)
      } else {
        setInternalPagination(next)
      }
    },
    onColumnVisibilityChange: setColumnVisibility,
    state: {
      sorting,
      pagination: controlledPagination,
      columnVisibility,
    },
  })

  const rows = table.getRowModel().rows
  const showSkeleton = isLoading
  const showError = !isLoading && isError
  const showEmpty = !isLoading && !isError && rows.length === 0
  // With a mobile card list: swap the table for the list only when there
  // are rows — loading/error/empty states stay shared across breakpoints.
  const hideTableOnMobile = !!mobileList && !showSkeleton && !showError && !showEmpty

  return (
    <div
      className={cn('w-full', className)}
      data-slot="data-table"
      data-testid={testId}
    >
      <div
        className={cn(
          bordered && 'overflow-hidden rounded-lg border bg-card',
          hideTableOnMobile && 'hidden md:block',
        )}
      >
        {toolbar && !showSkeleton ? toolbar(table) : null}

        {showSkeleton ? (
          /* ── Loading: structure-matched skeleton surface ──
           * NOT the real table: while loading we render generic shimmer
           * blocks mirroring the table's shape (header row + body rows +
           * pagination footer), so users see a placeholder — never real
           * column headers or data cells pretending to be loaded. */
          <div
            data-slot="table-skeleton"
            role="status"
            aria-busy="true"
            aria-label="Đang tải dữ liệu"
          >
            {/* Header row */}
            <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
              <Shimmer className="h-4 w-32" />
              <Shimmer className="h-4 w-24" />
              <Shimmer className="h-4 w-20 hidden sm:block" />
              <div className="flex-1" />
              <Shimmer className="h-4 w-16" />
            </div>
            {/* Body rows */}
            {Array.from({ length: skeletonRows }).map((_, rowIndex) => {
              const fade = 1 - rowIndex * (0.7 / Math.max(skeletonRows, 1))
              return (
                <div
                  key={`skeleton-row-${rowIndex}`}
                  className="flex items-center gap-4 border-b last:border-b-0 px-4 py-3.5"
                >
                  <Shimmer className="h-5 w-40" style={{ opacity: fade }} />
                  <Shimmer className="h-5 w-24" style={{ opacity: fade }} />
                  <Shimmer className="h-5 w-16 hidden sm:block" style={{ opacity: fade }} />
                  <Shimmer className="h-5 w-28 hidden md:block" style={{ opacity: fade }} />
                  <div className="flex-1" />
                  <Shimmer className="h-7 w-7 rounded-md" style={{ opacity: fade }} />
                </div>
              )
            })}
            {/* Pagination footer */}
            <div className="flex items-center justify-between px-4 py-3">
              <Shimmer className="h-4 w-36" />
              <div className="flex items-center gap-2">
                <Shimmer className="h-8 w-8 rounded-md" />
                <Shimmer className="h-8 w-8 rounded-md" />
                <Shimmer className="h-8 w-8 rounded-md" />
              </div>
            </div>
          </div>
        ) : (
          <Table>
            <TableHeader>
            {table.getHeaderGroups().map((headerGroup) => (
              <TableRow
                key={headerGroup.id}
                className="border-border/60 bg-muted/50 hover:bg-muted/50"
              >
                {headerGroup.headers.map((header) => {
                  const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined
                  const align = meta?.align ?? 'left'
                  const sortDirection = header.column.getIsSorted()
                  return (
                    <TableHead
                      key={header.id}
                      scope="col"
                      aria-sort={
                        sortDirection === 'asc'
                          ? 'ascending'
                          : sortDirection === 'desc'
                            ? 'descending'
                            : undefined
                      }
                      className={cn(
                        'h-10 bg-transparent px-4 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground',
                        ALIGN_CLASSES[align],
                        meta?.headerClassName,
                      )}
                    >
                      {header.isPlaceholder ? null : <FlexRender header={header} />}
                    </TableHead>
                  )
                })}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {showError ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
                    <AlertCircle className="mb-1 size-8 text-muted-foreground/60" aria-hidden />
                    <p className="text-sm font-medium">Không tải được dữ liệu</p>
                    <p className="text-xs text-muted-foreground">
                      Đã có lỗi xảy ra. Vui lòng thử lại.
                    </p>
                    {onRetry ? (
                      <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
                        Thử lại
                      </Button>
                    ) : null}
                  </div>
                </TableCell>
              </TableRow>
            ) : showEmpty ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={columns.length} className="p-0">
                  <div className="flex flex-col items-center justify-center gap-1.5 py-12 text-center">
                    <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
                      {emptyIcon ?? <Inbox className="size-5" aria-hidden />}
                    </div>
                    <p className="text-sm font-medium">{emptyTitle}</p>
                    {emptyDescription ? (
                      <p className="max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
                    ) : null}
                    {emptyAction}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              rows.map((row) => {
                const rowClass =
                  typeof rowClassName === 'function' ? rowClassName(row.original) : rowClassName
                return (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() ? 'selected' : undefined}
                    className={cn(onRowClick && 'cursor-pointer', rowClass)}
                    tabIndex={onRowClick ? 0 : undefined}
                    aria-label={rowAriaLabel ? rowAriaLabel(row.original) : undefined}
                    onClick={onRowClick ? () => onRowClick(row.original) : undefined}
                    onKeyDown={
                      onRowClick
                        ? (event) => {
                            if (event.key === 'Enter' && event.target === event.currentTarget) {
                              onRowClick(row.original)
                            }
                          }
                        : undefined
                    }
                  >
                    {row.getVisibleCells().map((cell) => {
                      const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined
                      const align = meta?.align ?? 'left'
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn('px-4 py-3', ALIGN_CLASSES[align], meta?.cellClassName)}
                        >
                          <FlexRender cell={cell} />
                        </TableCell>
                      )
                    })}
                  </TableRow>
                )
              })
            )}
          </TableBody>
        </Table>
        )}
      </div>

      {mobileList && hideTableOnMobile ? (
        <div
          className="overflow-hidden rounded-lg border bg-card md:hidden"
          data-slot="data-table-mobile-list"
        >
          {mobileList}
        </div>
      ) : null}

      {hidePagination || showSkeleton ? null : (
        <DataTablePagination
          table={table}
          noun={rowNoun}
          showPageSize={showPageSize}
          pageSizeOptions={pageSizeOptions}
          hideOnSinglePage={hidePaginationOnSinglePage}
          className={bordered ? 'rounded-b-lg border border-t-0 bg-card' : undefined}
        />
      )}
    </div>
  )
}
