/**
 * Shared TanStack Table v9 feature set for every data table in the app.
 *
 * Follows the official shadcn data-table guide
 * (https://ui.shadcn.com/docs/components/base/data-table): declare the
 * features each table uses so anything unlisted is tree-shaken out of the
 * bundle, and export the resulting type so `ColumnDef`, `Column`, `Table`
 * and `Row` know which feature APIs are available.
 *
 * `columnMeta` is a type-only slot — the value is ignored at runtime, only
 * its type is used wherever `TFeatures` flows (per-column align/labels).
 */

import {
  columnFilteringFeature,
  columnVisibilityFeature,
  createFilteredRowModel,
  createPaginatedRowModel,
  createSortedRowModel,
  filterFn_includesString,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from '@tanstack/react-table'

/** Per-column presentation options consumed by the DataTable renderer. */
export interface DataTableColumnMeta {
  /** Horizontal alignment applied to both the header and the cells. */
  align?: 'left' | 'center' | 'right'
  /** Extra classes for the `<th>` (e.g. responsive `hidden md:table-cell`). */
  headerClassName?: string
  /** Extra classes for the `<td>` (e.g. responsive `hidden md:table-cell`). */
  cellClassName?: string
  /** Human-friendly column name for the column-visibility menu. */
  label?: string
}

export const dataTableFeatures = tableFeatures({
  columnFilteringFeature,
  columnVisibilityFeature,
  rowPaginationFeature,
  rowSelectionFeature,
  rowSortingFeature,
  filteredRowModel: createFilteredRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortedRowModel: createSortedRowModel(),
  filterFns: { includesString: filterFn_includesString },
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    basic: sortFn_basic,
    datetime: sortFn_datetime,
  },
  columnMeta: {} as DataTableColumnMeta,
})

export type DataTableFeatures = typeof dataTableFeatures
