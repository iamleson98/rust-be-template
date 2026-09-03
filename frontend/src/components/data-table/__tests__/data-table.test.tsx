import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { createColumnHelper } from '@tanstack/react-table'

import { Button } from '@/components/ui/button'

import { DataTable } from '../data-table'
import { DataTableColumnHeader } from '../data-table-column-header'
import type { DataTableFeatures } from '../data-table-features'

interface Payment {
  id: string
  email: string
  amount: number
}

const payments: Payment[] = [
  { id: '1', email: 'abe@example.com', amount: 100 },
  { id: '2', email: 'ken@example.com', amount: 300 },
  { id: '3', email: 'mon@example.com', amount: 200 },
]

const columnHelper = createColumnHelper<DataTableFeatures, Payment>()
const columns = columnHelper.columns([
  columnHelper.accessor('email', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Email" />,
    meta: { label: 'Email' },
  }),
  columnHelper.accessor('amount', {
    header: ({ column }) => <DataTableColumnHeader column={column} title="Amount" />,
    meta: { align: 'right', label: 'Amount' },
  }),
])

describe('DataTable', () => {
  it('renders a semantic table with headers and rows', () => {
    render(<DataTable columns={columns} data={payments} />)

    expect(screen.getByRole('table')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /email/i })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /amount/i })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'abe@example.com' })).toBeInTheDocument()
    expect(screen.getByRole('cell', { name: 'ken@example.com' })).toBeInTheDocument()
  })

  it('shows the Vietnamese empty state when there are no rows', () => {
    render(
      <DataTable
        columns={columns}
        data={[]}
        emptyTitle="Chưa có dữ liệu"
        emptyDescription="Thử thay đổi bộ lọc."
      />,
    )

    expect(screen.getByText('Chưa có dữ liệu')).toBeInTheDocument()
    expect(screen.getByText('Thử thay đổi bộ lọc.')).toBeInTheDocument()
  })

  it('renders skeleton rows while loading', () => {
    render(<DataTable columns={columns} data={[]} isLoading />)

    // 6 default skeleton rows × 2 columns
    expect(document.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThanOrEqual(12)
    expect(screen.queryByRole('cell', { name: 'abe@example.com' })).not.toBeInTheDocument()
  })

  it('shows an error state with a retry button', async () => {
    const onRetry = vi.fn()
    render(<DataTable columns={columns} data={[]} isError onRetry={onRetry} />)

    expect(screen.getByText('Không tải được dữ liệu')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Thử lại' }))
    expect(onRetry).toHaveBeenCalledTimes(1)
  })

  it('sorts rows client-side when a sortable header is clicked', async () => {
    render(<DataTable columns={columns} data={payments} />)

    const headerButton = screen.getByRole('button', { name: /sắp xếp theo amount/i })
    await userEvent.click(headerButton)

    // First click → ascending: 100 (abe) should come before 300 (ken)
    const cells = screen.getAllByRole('row').slice(1) // skip header row
    expect(cells[0]).toHaveTextContent('abe@example.com')

    // aria-sort reflects the direction
    expect(screen.getByRole('columnheader', { name: /amount/i })).toHaveAttribute(
      'aria-sort',
      'ascending',
    )
  })

  it('toggles between ascending and descending sort', async () => {
    render(<DataTable columns={columns} data={payments} />)

    const headerButton = screen.getByRole('button', { name: /sắp xếp theo email/i })
    await userEvent.click(headerButton)
    await userEvent.click(headerButton)

    expect(screen.getByRole('columnheader', { name: /email/i })).toHaveAttribute(
      'aria-sort',
      'descending',
    )
    const cells = screen.getAllByRole('row').slice(1)
    expect(cells[0]).toHaveTextContent('mon@example.com')
  })

  it('hides a column from the header dropdown menu', async () => {
    render(<DataTable columns={columns} data={payments} />)

    // Base UI portals mount asynchronously — open, flush, then pick the item.
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole('button', { name: /tuỳ chọn cột email/i })[0],
      )
      await new Promise((r) => setTimeout(r, 50))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: /ẩn cột này/i }))
    })

    expect(screen.queryByRole('columnheader', { name: /email/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('cell', { name: 'abe@example.com' })).not.toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /amount/i })).toBeInTheDocument()
  })

  it('paginates client-side with a Vietnamese range label', async () => {
    render(
      <DataTable columns={columns} data={payments} defaultPageSize={2} showPageSize />,
    )

    expect(screen.getByText(/hiển thị 1–2 \/ 3 dòng/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }))

    await waitFor(() => {
      expect(screen.getByText(/hiển thị 3–3 \/ 3 dòng/i)).toBeInTheDocument()
    })
    expect(screen.getByText(/trang 2 \/ 2/i)).toBeInTheDocument()
  })

  it('supports manual (server-side) pagination via controlled pageIndex', async () => {
    const onPageIndexChange = vi.fn()
    const { rerender } = render(
      <DataTable
        columns={columns}
        data={payments.slice(0, 2)}
        manualPagination
        totalRowCount={3}
        pageIndex={0}
        pageSize={2}
        onPageIndexChange={onPageIndexChange}
      />,
    )

    expect(screen.getByText(/hiển thị 1–2 \/ 3 dòng/i)).toBeInTheDocument()
    expect(screen.getByText(/trang 1 \/ 2/i)).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }))
    expect(onPageIndexChange).toHaveBeenCalledWith(1)

    // The parent controls the page — simulate it advancing
    rerender(
      <DataTable
        columns={columns}
        data={payments.slice(2)}
        manualPagination
        totalRowCount={3}
        pageIndex={1}
        pageSize={2}
        onPageIndexChange={onPageIndexChange}
      />,
    )
    expect(screen.getByText(/hiển thị 3–3 \/ 3 dòng/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled()
  })

  it('invokes onRowClick when a row is clicked, with a pointer cursor', async () => {
    const onRowClick = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={payments}
        onRowClick={onRowClick}
        rowAriaLabel={(row) => `Xem ${row.email}`}
      />,
    )

    const row = screen.getByRole('row', { name: /Xem abe@example.com/i })
    expect(row.className).toContain('cursor-pointer')

    await userEvent.click(row)
    expect(onRowClick).toHaveBeenCalledWith(payments[0])
  })

  it('opens the row via the Enter key for keyboard users', async () => {
    const onRowClick = vi.fn()
    render(
      <DataTable
        columns={columns}
        data={payments}
        onRowClick={onRowClick}
        rowAriaLabel={(row) => `Xem ${row.email}`}
      />,
    )

    const row = screen.getByRole('row', { name: /Xem abe@example.com/i })
    row.focus()
    await userEvent.keyboard('{Enter}')
    expect(onRowClick).toHaveBeenCalledWith(payments[0])
  })

  it('renders a toolbar slot that receives the table instance', () => {
    render(
      <DataTable
        columns={columns}
        data={payments}
        toolbar={(table) => (
          <Button variant="outline" size="sm" onClick={() => table.getColumn('email')?.toggleVisibility(false)}>
            Hide email
          </Button>
        )}
      />,
    )

    expect(screen.getByRole('button', { name: 'Hide email' })).toBeInTheDocument()
  })
})
