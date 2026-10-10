import { Fragment, useState, type ReactNode } from 'react'
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
  type Row,
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

import { useT } from '@/lib/i18n'
import { cn } from '@/lib/utils'
import {
  dataTableFeatures,
  type DataTableColumnMeta,
  type DataTableFeatures,
} from './data-table-features'
import { DataTablePagination } from './data-table-pagination'
import { useIsMobile } from '@/hooks/use-mobile'

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
  /** Render the card surface around the table, its phone cards and the pager. */
  bordered?: boolean
  /** Rendered above the table — receives the table instance (e.g. column menu). */
  toolbar?: (table: ReactTable<DataTableFeatures, TData>) => ReactNode
  /**
   * Mobile card list — replaces the table on small screens while states
   * (skeleton/error/empty) and the pagination footer stay shared. Without
   * one, each row becomes a card of its labelled columns (see `RowCards`).
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
  emptyTitle,
  emptyDescription,
  emptyIcon,
  emptyAction,
  bordered = true,
  toolbar,
  mobileList,
  className,
  testId,
}: DataTableProps<TData>) {
  const t = useT()
  const isMobile = useIsMobile()
  const effectiveEmptyTitle = emptyTitle ?? t('dataTable.emptyTitle')
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
    getRowId:
      getRowId ??
      ((row, index) => {
        const id = (row as { id?: unknown }).id
        return id == null ? String(index) : String(id)
      }),
    manualPagination,
    manualSorting,
    autoResetPageIndex: !manualPagination,
    rowCount: manualPagination ? totalRowCount : undefined,
    onSortingChange: (updater) => {
      const next =
        typeof updater === 'function'
          ? (updater as (prev: SortingState) => SortingState)(sorting)
          : updater
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
  const hasRows = !showSkeleton && !showError && !showEmpty
  // A custom `mobileList` swaps with the table by CSS; without one, phones
  // render each row as a card (one layout in the DOM, not two).
  const hideTableOnMobile = !!mobileList && hasRows

  const stateMessage = showError ? (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
      <AlertCircle className="mb-1 size-8 text-muted-foreground/60" aria-hidden />
      <p className="text-sm font-medium">{t('dataTable.loadError')}</p>
      <p className="text-xs text-muted-foreground">{t('dataTable.loadErrorDesc')}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" className="mt-2" onClick={onRetry}>
          {t('common.retry')}
        </Button>
      ) : null}
    </div>
  ) : showEmpty ? (
    <div className="flex flex-col items-center justify-center gap-1.5 px-4 py-12 text-center">
      <div className="mb-1 flex size-11 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {emptyIcon ?? <Inbox className="size-5" aria-hidden />}
      </div>
      <p className="text-sm font-medium">{effectiveEmptyTitle}</p>
      {emptyDescription ? (
        <p className="max-w-sm text-xs text-muted-foreground">{emptyDescription}</p>
      ) : null}
      {emptyAction}
    </div>
  ) : null

  // Phones never scroll a table sideways: states stand alone (no header row)
  // and rows become cards unless the caller brought its own list.
  let body: ReactNode
  if (showSkeleton) {
    body = <TableSkeleton rows={skeletonRows} label={t('dataTable.loadingData')} />
  } else if (isMobile && stateMessage) {
    body = stateMessage
  } else if (isMobile && !mobileList) {
    body = <RowCards rows={rows} onRowClick={onRowClick} rowAriaLabel={rowAriaLabel} />
  } else {
    body = (
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
          {stateMessage ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={columns.length} className="p-0">
                {stateMessage}
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
    )
  }

  return (
    // One surface for the toolbar, the rows (or the phone cards) and the pager.
    <div
      className={cn(
        'w-full',
        bordered &&
          'overflow-hidden rounded-2xl bg-card shadow-soft ring-1 ring-slate-200/80 dark:ring-white/10',
        className,
      )}
      data-slot="data-table"
      data-testid={testId}
    >
      {toolbar && !showSkeleton ? toolbar(table) : null}
      <div className={cn(hideTableOnMobile && 'hidden md:block')}>{body}</div>

      {hideTableOnMobile ? (
        <div className="md:hidden" data-slot="data-table-mobile-list">
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
        />
      )}
    </div>
  )
}

/**
 * The loading surface: shimmer blocks shaped like the table (header row, body
 * rows, pagination footer) — never real column headers pretending to be loaded.
 */
function TableSkeleton({ rows, label }: { rows: number; label: string }) {
  return (
    <div data-slot="table-skeleton" role="status" aria-busy="true" aria-label={label}>
      <div className="flex items-center gap-4 border-b bg-muted/40 px-4 py-3">
        <Shimmer className="h-4 w-32" />
        <Shimmer className="h-4 w-24" />
        <Shimmer className="hidden h-4 w-20 sm:block" />
        <div className="flex-1" />
        <Shimmer className="h-4 w-16" />
      </div>
      {Array.from({ length: rows }).map((_, rowIndex) => {
        const fade = 1 - rowIndex * (0.7 / Math.max(rows, 1))
        return (
          <div
            key={`skeleton-row-${rowIndex}`}
            className="flex items-center gap-4 border-b px-4 py-3.5 last:border-b-0"
          >
            <Shimmer className="h-5 w-40" style={{ opacity: fade }} />
            <Shimmer className="h-5 w-24" style={{ opacity: fade }} />
            <Shimmer className="hidden h-5 w-16 sm:block" style={{ opacity: fade }} />
            <Shimmer className="hidden h-5 w-28 md:block" style={{ opacity: fade }} />
            <div className="flex-1" />
            <Shimmer className="h-7 w-7 rounded-md" style={{ opacity: fade }} />
          </div>
        )
      })}
      <div className="flex items-center justify-between px-4 py-3">
        <Shimmer className="h-4 w-36" />
        <div className="flex items-center gap-2">
          <Shimmer className="h-8 w-8 rounded-md" />
          <Shimmer className="h-8 w-8 rounded-md" />
          <Shimmer className="h-8 w-8 rounded-md" />
        </div>
      </div>
    </div>
  )
}

/** A column's name for a card label: its meta label, else a plain-string header. */
function columnLabel(column: { columnDef: { meta?: unknown; header?: unknown } }): string | null {
  const meta = column.columnDef.meta as DataTableColumnMeta | undefined
  if (meta?.label) return meta.label
  const header = column.columnDef.header
  return typeof header === 'string' && header.trim() ? header : null
}

/**
 * The default phone layout: each row a card — the `cardTitle` column (else the
 * first labelled one) as its title, the other labelled ones as label/value
 * pairs, and the `actions` column or unlabelled ones (menus) along the bottom.
 */
function RowCards<TData extends RowData>({
  rows,
  onRowClick,
  rowAriaLabel,
}: {
  rows: Row<DataTableFeatures, TData>[]
  onRowClick?: (row: TData) => void
  rowAriaLabel?: (row: TData) => string
}) {
  return (
    <ul className="divide-y">
      {rows.map((row) => {
        const cells = row.getVisibleCells()
        const isAction = (cell: (typeof cells)[number]) =>
          cell.column.id === 'actions' || !columnLabel(cell.column)
        const actions = cells.filter(isAction)
        const labelled = cells.filter((cell) => !isAction(cell))
        const title =
          labelled.find(
            (cell) => (cell.column.columnDef.meta as DataTableColumnMeta | undefined)?.cardTitle,
          ) ?? labelled[0]
        const fields = labelled.filter((cell) => cell !== title)
        return (
          <li
            key={row.id}
            className={cn('space-y-2 p-4', onRowClick && 'cursor-pointer active:bg-muted/50')}
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
            {title && (
              <div className="min-w-0 text-sm font-medium">
                <FlexRender cell={title} />
              </div>
            )}
            {fields.length > 0 && (
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
                {fields.map((cell) => (
                  <Fragment key={cell.id}>
                    <dt className="text-xs text-muted-foreground">{columnLabel(cell.column)}</dt>
                    <dd className="min-w-0 text-right [&>*]:ml-auto">
                      <FlexRender cell={cell} />
                    </dd>
                  </Fragment>
                ))}
              </dl>
            )}
            {actions.length > 0 && (
              <div
                className="flex flex-wrap items-center justify-end gap-2"
                onClick={(event) => event.stopPropagation()}
              >
                {actions.map((cell) => (
                  <FlexRender key={cell.id} cell={cell} />
                ))}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
