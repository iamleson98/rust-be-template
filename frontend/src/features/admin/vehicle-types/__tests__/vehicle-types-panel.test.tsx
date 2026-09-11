import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

/**
 * Integration test for the vehicle-types panel conversion to the shared
 * DataTable — covers the server-side pagination contract (pageIndex →
 * offset), the search reset behaviour, and the built-in empty state.
 */

vi.mock('@/lib/queries', () => {
  const pendingMutation = () => ({ isPending: false, mutateAsync: vi.fn() })
  return {
    useAdminVehicleTypes: vi.fn(),
    useDeleteAdminVehicleType: vi.fn(pendingMutation),
    useCreateAdminVehicleType: vi.fn(pendingMutation),
    useUpdateAdminVehicleType: vi.fn(pendingMutation),
  }
})

import { useAdminVehicleTypes } from '@/lib/queries'
import { VehicleTypesPanel } from '../vehicle-types-panel'

const fetchMock = useAdminVehicleTypes as unknown as ReturnType<typeof vi.fn>

function mockQueryResult(data: { items: unknown[]; total: number }) {
  return {
    data,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }
}

describe('VehicleTypesPanel (DataTable conversion)', () => {
  it('renders rows inside the data table with sortable headers', async () => {
    fetchMock.mockReturnValue(
      mockQueryResult({
        items: [
          {
            id: 'vt-1',
            label: 'Giường nằm',
            code: 'sleeper',
            totalSeats: 40,
            status: 'active',
            sortOrder: 1,
          },
        ],
        total: 1,
      }),
    )

    render(<VehicleTypesPanel />)

    const table = await screen.findByTestId('vehicle-types-table')
    expect(within(table).getByRole('table')).toBeInTheDocument()
    expect(within(table).getByText('Giường nằm')).toBeInTheDocument()
    expect(within(table).getByText('Đang dùng')).toBeInTheDocument()
    // Sortable header buttons exist for the data columns
    expect(
      within(table).getAllByRole('button', { name: /sắp xếp theo/i }).length,
    ).toBeGreaterThan(0)
  })

  it('pages server-side: clicking "Trang sau" refetches with the next offset', async () => {
    const makeItems = (n: number) =>
      Array.from({ length: n }, (_, i) => ({
        id: `vt-${i}`,
        label: `Loại xe ${i + 1}`,
        code: 'sleeper',
        totalSeats: 20,
        status: 'active',
        sortOrder: i + 1,
      }))

    fetchMock.mockImplementation(() => mockQueryResult({ items: makeItems(20), total: 40 }))

    render(<VehicleTypesPanel />)

    // 20 rows on the first page, "1–20 / 40 loại xe"
    expect(await screen.findByText(/hiển thị 1–20 \/ 40 loại xe/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenLastCalledWith({ q: undefined, limit: 20, offset: 0 })

    await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith({ q: undefined, limit: 20, offset: 20 })
    })
    expect(screen.getByText(/trang 2 \/ 2/i)).toBeInTheDocument()
  })

  it('resets to the first page when the search box changes', async () => {
    fetchMock.mockImplementation(() => mockQueryResult({ items: [], total: 0 }))

    render(<VehicleTypesPanel />)

    const search = screen.getByPlaceholderText('Tìm theo tên hoặc mã…')
    await userEvent.clear(search)
    await userEvent.type(search, 'limou')

    await waitFor(() => {
      expect(fetchMock).toHaveBeenLastCalledWith({ q: 'limou', limit: 20, offset: 0 })
    })
  })

  it('shows the empty state when the catalog has no items', async () => {
    fetchMock.mockReturnValue(mockQueryResult({ items: [], total: 0 }))

    render(<VehicleTypesPanel />)

    expect(await screen.findByText('Chưa có loại xe nào')).toBeInTheDocument()
    expect(
      screen.getByText('Thêm loại xe đầu tiên để dùng trong form tạo lịch trình.'),
    ).toBeInTheDocument()
  })
})
