'use client'

/**
 * Pagination footer following the shadcn data-table guide (rows-per-page
 * select, page indicator, first/prev/next/last icon buttons), localised
 * to Vietnamese and extended for server-side ("manual") pagination:
 * `rowCount` supplied by the table options drives the range label and
 * page count, so the same component works for both modes.
 */

import type { RowData } from '@tanstack/react-table'
import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import { ComboboxField } from '@/components/ui/combobox'
import type { ReactTable } from '@tanstack/react-table'

import { cn } from '@/lib/utils'
import { useT } from '@/lib/i18n'
import type { DataTableFeatures } from './data-table-features'

interface DataTablePaginationProps<TData extends RowData> {
  table: ReactTable<DataTableFeatures, TData>
  /** Vietnamese noun used in the "Hiển thị X–Y / N <noun>" label. */
  noun?: string
  /** Offer a rows-per-page select (client mode, or manual mode with a handler). */
  showPageSize?: boolean
  pageSizeOptions?: number[]
  /** Hide the whole bar when everything fits on one page. Default: true. */
  hideOnSinglePage?: boolean
  className?: string
}

export function DataTablePagination<TData extends RowData>({
  table,
  noun,
  showPageSize = false,
  pageSizeOptions = [10, 20, 30, 40, 50],
  hideOnSinglePage = true,
  className,
}: DataTablePaginationProps<TData>) {
  const t = useT()
  const { pageIndex, pageSize } = table.state.pagination
  const pageCount = table.getPageCount()
  const total = table.getRowCount()
  const selectedCount = table.getFilteredSelectedRowModel().rows.length
  const visibleCount = table.getRowModel().rows.length

  const from = total === 0 ? 0 : pageIndex * pageSize + 1
  const to = from + visibleCount - 1
  const effectiveNoun = noun ?? t('dataTable.rowNoun')

  if (hideOnSinglePage && pageCount <= 1 && selectedCount === 0 && !showPageSize) {
    return null
  }

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-2 border-t bg-muted/40 px-4 py-2.5 text-xs text-muted-foreground',
        className,
      )}
      data-slot="data-table-pagination"
      data-testid="data-table-pagination"
    >
      <div className="flex min-w-0 items-center gap-2 tabular-nums">
        {selectedCount > 0 ? (
          <span>
            {t('common.selected', { selected: selectedCount, total, noun: effectiveNoun })}
          </span>
        ) : (
          <span>
            {t('common.showing', { from: total === 0 ? 0 : from, to, total, noun: effectiveNoun })}
          </span>
        )}
      </div>

      <div className="flex items-center gap-4">
        {showPageSize ? (
          <div className="flex items-center gap-2">
            <span className="hidden sm:inline">{t('common.rowsPerPage')}</span>
            <ComboboxField
              value={`${pageSize}`}
              onValueChange={(value) => table.setPageSize(Number(value))}
              items={pageSizeOptions.map((option) => ({
                value: `${option}`,
                label: `${option}`,
              }))}
              className="h-7 w-18 text-xs tabular-nums"
              contentClassName="min-w-20"
              searchPlaceholder={t('dataTable.rowsPerPageSearch')}
              aria-label={t('common.rowsPerPage')}
              data-testid="page-size-combobox"
            />
          </div>
        ) : null}

        <div className="flex items-center gap-2">
          <span className="tabular-nums">
            {t('common.page', { page: pageIndex + 1 })}
            {pageCount > 0 && pageCount !== Infinity ? ` / ${pageCount}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="hidden size-7 lg:flex"
              onClick={() => table.firstPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{t('common.firstPage')}</span>
              <ChevronsLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => table.previousPage()}
              disabled={!table.getCanPreviousPage()}
            >
              <span className="sr-only">{t('common.prevPage')}</span>
              <ChevronLeft className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="size-7"
              onClick={() => table.nextPage()}
              disabled={!table.getCanNextPage()}
            >
              <span className="sr-only">{t('common.nextPage')}</span>
              <ChevronRight className="size-3.5" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              className="hidden size-7 lg:flex"
              onClick={() => table.lastPage()}
              disabled={!table.getCanLastPage()}
            >
              <span className="sr-only">{t('common.lastPage')}</span>
              <ChevronsRight className="size-3.5" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
