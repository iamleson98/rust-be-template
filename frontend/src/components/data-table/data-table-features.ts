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
  /** Title of the row's phone card (default: the first labelled column). */
  cardTitle?: boolean
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
