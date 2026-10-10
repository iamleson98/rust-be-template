import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { mockApi, renderWithQuery } from '@/test/api'
import { VehicleTypesPanel } from '../vehicle-types-panel'

/**
 * Integration test for the vehicle-types panel conversion to the shared
 * DataTable — covers the server-side pagination contract (pageIndex →
 * offset), the search reset behaviour, and the built-in empty state.
 */

const LIST = 'GET /api/admin/vehicle-types'

const vehicleType = (i: number, extra = {}) => ({
  id: `vt-${i}`,
  label: `Loại xe ${i + 1}`,
  code: 'sleeper',
  totalSeats: 20,
  status: 'active',
  sortOrder: i + 1,
  ...extra,
})

describe('VehicleTypesPanel (DataTable conversion)', () => {
  it('renders rows inside the data table with sortable headers', async () => {
    mockApi({
      [LIST]: { items: [vehicleType(0, { label: 'Giường nằm', totalSeats: 40 })], total: 1 },
    })

    renderWithQuery(<VehicleTypesPanel />)

    const table = await screen.findByTestId('vehicle-types-table')
    expect(await within(table).findByRole('table')).toBeInTheDocument()
    expect(within(table).getByText('Giường nằm')).toBeInTheDocument()
    expect(within(table).getByText('Đang dùng')).toBeInTheDocument()
    // Sortable header buttons exist for the data columns
    expect(within(table).getAllByRole('button', { name: /sắp xếp theo/i }).length).toBeGreaterThan(
      0,
    )
  })

  it('pages server-side: clicking "Trang sau" refetches with the next offset', async () => {
    const api = mockApi({
      [LIST]: () => ({ items: Array.from({ length: 20 }, (_, i) => vehicleType(i)), total: 40 }),
    })

    renderWithQuery(<VehicleTypesPanel />)

    // 20 rows on the first page, "1–20 / 40 loại xe"
    expect(await screen.findByText(/hiển thị 1–20 \/ 40 loại xe/i)).toBeInTheDocument()
    expect(api.last('/api/admin/vehicle-types')?.url.searchParams.get('offset')).toBe('0')

    await userEvent.click(screen.getByRole('button', { name: 'Trang sau' }))

    await waitFor(() => {
      expect(api.last('/api/admin/vehicle-types')?.url.searchParams.get('offset')).toBe('20')
    })
    expect(screen.getByText(/trang 2 \/ 2/i)).toBeInTheDocument()
  })

  it('resets to the first page when the search box changes', async () => {
    const api = mockApi({ [LIST]: { items: [], total: 0 } })

    renderWithQuery(<VehicleTypesPanel />)

    const search = screen.getByPlaceholderText('Tìm theo tên hoặc mã…')
    await userEvent.clear(search)
    await userEvent.type(search, 'limou')

    await waitFor(() => {
      const params = api.last('/api/admin/vehicle-types')?.url.searchParams
      expect(params?.get('q')).toBe('limou')
      expect(params?.get('offset')).toBe('0')
    })
  })

  it('shows the empty state when the catalog has no items', async () => {
    mockApi({ [LIST]: { items: [], total: 0 } })

    renderWithQuery(<VehicleTypesPanel />)

    expect(await screen.findByText('Chưa có loại xe nào')).toBeInTheDocument()
    expect(
      screen.getByText('Thêm loại xe đầu tiên để dùng trong form tạo lịch trình.'),
    ).toBeInTheDocument()
  })
})
