/**
 * Reusable data-table primitives built on the official shadcn data-table
 * guide (TanStack Table v9, feature-based API). See
 * https://ui.shadcn.com/docs/components/base/data-table
 *
 * Typical usage:
 *   const columnHelper = createColumnHelper<DataTableFeatures, Payment>()
 *   const columns = columnHelper.columns([...])
 *   <DataTable columns={columns} data={payments} />
 *
 * Server-side ("manual") pagination + sorting:
 *   <DataTable
 *     columns={columns} data={page.items}
 *     manualPagination totalRowCount={page.total}
 *     pageIndex={page} onPageIndexChange={setPage}
 *     manualSorting sorting={sorting} onSortingChange={setSorting}
 *   />
 */

export { dataTableFeatures, type DataTableFeatures, type DataTableColumnMeta } from './data-table-features'
export { DataTable, type DataTableProps } from './data-table'
export { DataTableColumnHeader } from './data-table-column-header'
export { DataTablePagination } from './data-table-pagination'
export { DataTableViewOptions } from './data-table-view-options'
